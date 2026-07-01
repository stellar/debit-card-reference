# debit-card-reference

> [!WARNING]
> This repository is a reference implementation for learning and prototyping.
> It has not been audited. Use at your own risk.

## Overview

This project is a reference implementation of a card-like debit flow on Stellar.
It is designed for non-custodial wallets, so card payments can spend directly
from user-controlled balances.

Funds remain in the wallet until a payment is authorized and executed. This
avoids requiring users to preload funds into a custodial card account.

## Contract Architecture

The system uses two contracts:

- `factory`: policy and orchestration contract.
- `issuer`: per-issuer execution contract that performs token `transfer_from`.

The factory deploys one issuer contract per `(issuer_id, token)` pair. Cardholder
wallets approve that issuer contract as spender.

## Roles And Authorization

- `owner` (factory constructor arg):
  deploys issuers (`create_issuer`), manages destination allowlists
  (`update_issuer_destination`), rotates issuer manager
  (`set_authorized_manager`).
- `pauser` (factory constructor arg):
  can `pause` and `unpause` guarded operations.
- `manager` (per `issuer_id`):
  authorizes debitors (`update_authorized_debitor`) and sets per-user velocity
  controls (`update_user_velocity`).
- `debitor`:
  signed caller of `transfer_to_destination` (typically issuer backend / processor).
- `cardholder`:
  wallet owner whose account is debited after approving the issuer contract.

## Trust Model And Privileged Roles

The `owner` is the system's root of trust. By design, and without any code
upgrade or cardholder action, the owner can reach every guardrail that
constrains how an allowance is spent:

- it can reassign a per-issuer `manager` to itself (`set_authorized_manager`),
  and as that manager authorize itself as a `debitor`
  (`update_authorized_debitor`) and raise velocity limits
  (`update_user_velocity`);
- it can allowlist a destination it controls (`update_issuer_destination`, or
  the `destination` argument of `create_issuer`);
- it can then call `transfer_to_destination` to pull from any account holding a
  live allowance to the issuer contract, up to that allowance.

The owner can also replace the factory's or any issuer's bytecode in place
(`upgrade`, `upgrade_issuer`). `upgrade_issuer` preserves the issuer contract's
address, and the cardholder's SEP-41 allowance is keyed by
`(from, spender = issuer_address)`, so every existing allowance remains
spendable by the replacement code with no cardholder action. The upgrade paths
are intentionally not gated by the pause flag — the owner must be able to ship a
fix while the contract is frozen — so a pauser freeze does not constrain the
owner.

This concentration of authority is inherent to a non-custodial pull-payment
model: the allowance exists precisely so the card operator can debit the wallet
when a card is swiped, and the owner key is that operator. The role split
(owner / manager / debitor) bounds the blast radius of a *manager* or *debitor*
key compromise; it is not a trust boundary against the owner.

A cardholder's exposure is always bounded by their token allowance amount and
its `expiration_ledger`, and can be removed at any time by re-approving `0` or
letting the allowance expire.

### Debitor Key Compromise

The `debitor` is the largest operational attack surface in a running deployment:
it is the internet-facing hot key a payments backend signs with on every card
swipe. `transfer_to_destination` authenticates only that debitor. The debited
`account` is a parameter chosen by the debitor — the cardholder consents once,
up front, through the token allowance, and does not sign each debit. This is
inherent to the card flow: at swipe time the cardholder cannot produce a
signature inside the card network's authorization window. Debitor authorization
is keyed by `issuer_id` alone (`AuthorizedDebitor(issuer_id, debitor)`), so a
single authorized debitor key is valid across every token under that issuer.

A compromised debitor key can therefore attempt debits against every account
holding a live allowance to that issuer's contracts, across all of the issuer's
tokens, with no cardholder action — the blast radius is the issuer's entire
enrolled user base. Four controls bound that blast radius:

1. The debitor cannot administer policy. It cannot allowlist a payout address
   (`update_issuer_destination` is owner-only) and it cannot raise velocity
   limits (`update_user_velocity` is manager-only). Funds only ever settle to a
   destination the owner allowlisted, so direct theft requires a colluding or
   attacker-controlled allowlisted destination; absent that, the damage is
   forced payments to *legitimate* destinations, which the operator can reverse
   off-chain. This separation of duties is the one hard on-chain bound.
2. Per-account drain is rate-limited. The per-transaction cap, the
   rolling-period cap, and the one-transfer-per-ledger guard
   (`validate_and_update_user_velocity`) cap how fast any single cardholder can
   be drained.
3. Each debit is bounded by the cardholder's allowance amount and its
   `expiration_ledger`. No debit can exceed the approved amount, and the
   exposure ends when the allowance expires or is re-approved to `0`.
4. Incident response. The `pauser` can freeze *all* transfers globally, and the
   `manager` can revoke the key with `update_authorized_debitor`. These are
   alternative levers, not simultaneous ones: `update_authorized_debitor` is
   itself pause-gated, so revocation requires a non-paused contract. Freeze
   first to stop the bleeding (then unpause to revoke), or revoke the key first
   and pause only if broader containment is needed.

### Deployment Guidance

1. Set `owner` to an address with shared control, not a single key. This can be
   a Stellar account configured with multiple signers and a high signing
   threshold, or a contract address that enforces its own governance (for
   example a multisig or timelock contract). Consider using a separate upgrade
   authority and/or a timelock for `upgrade` and `upgrade_issuer`, so role and
   code changes are observable on-chain before they take effect.
2. Keep per-user velocity limits low and instruct wallets to grant small,
   short-lived allowances, so the bounded exposure of any owner action or key
   compromise stays within an acceptable loss.
3. Every role change and upgrade emits an event (`OwnerUpdated`,
   `PauserUpdated`, `ManagedUpdated`, `DebitorUpdated`, `DestinationUpdated`,
   `UserVelocityUpdated`, `ContractUpgraded`, `IssuerUpgraded`). Monitor these
   and alert on any change that did not originate from an expected operator
   action.
4. Treat the debitor as a least-privilege, frequently rotated hot key: give it
   no other role, rotate it on a schedule via `update_authorized_debitor`
   (authorize the new key, then revoke the old), and keep each issuer's
   destination allowlist as small as the settlement flow permits.
5. Monitor `TransferExecuted` events for anomalies — volume spikes, many
   distinct accounts debited in a short window, or off-hours activity — and wire
   alerts into the pause and debitor-revocation incident path so a suspected key
   compromise can be contained immediately.

Pause does not constrain the owner: the upgrade paths are not pause-gated, and
the owner can rotate roles and execute transfers through the paths above
regardless of who holds the pauser role.

## Expected Setup Flow

1. Deploy `issuer` Wasm and get its hash.
2. Deploy `factory` with constructor args:
   `owner`, `pauser`, `issuer_wasm_hash`.
3. Owner calls `create_issuer(issuer_id, token, manager, destination)`:
   this deploys the issuer contract and stores policy state.
4. Read or record issuer contract address:
   from `create_issuer` return value, `IssuerCreated` event, or
   `get_issuer_address(issuer_id, token)`.
5. Owner optionally updates allowed destinations with
   `update_issuer_destination`.
6. Manager authorizes one or more debitors with
   `update_authorized_debitor`.
7. Manager configures per-cardholder velocity with `update_user_velocity`.
   This is required before first spend for each `(issuer_id, token, user)`
   scope.
8. Cardholder wallet approves the issuer contract to spend token balance.

## Payment Execution Flow

For each card payment, an authorized debitor calls:

`transfer_to_destination(issuer_id, token, debitor, account, amount, destination, uuid)`

Factory checks include:

- contract is not paused
- debitor is authorized and provides signature
- destination is allowlisted for issuer
- issuer exists for `(issuer_id, token)`
- velocity constraints pass:
  positive amount, per-transaction limit, fixed-window period limit,
  and one transfer per ledger
  (see [Velocity Semantics](#velocity-semantics) for how the period limit
  behaves at a window boundary)

If checks pass, factory calls the issuer contract, and issuer performs:

`token.transfer_from(spender = issuer_contract, from = account, to = destination, amount)`

So the cardholder must have enough balance and a valid token allowance to that
issuer contract.

## Wallet Integration (Cardholder Side)

The wallet only needs to perform the token `approve` step so the issuer
contract can later pull funds during a card payment.

```ts
import {
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";

const rpcUrl = "https://soroban-testnet.stellar.org";
const networkPassphrase = Networks.TESTNET;

const tokenId = "C..."; // SEP-41 token contract ID
const issuerContractId = "C..."; // Issuer contract ID provided by the card issuer

const account = Keypair.fromSecret(process.env.ACCOUNT_SECRET!); // Wallet account secret key
const server = new rpc.Server(rpcUrl);
const token = new Contract(tokenId);

const amount = 100n; // token base units
const latest = await server.getLatestLedger();
const expirationLedger = Math.min(latest.sequence + 1000, 3_110_400);

const approveOp = token.call(
  "approve",
  nativeToScVal(account.publicKey(), { type: "address" }),
  nativeToScVal(issuerContractId, { type: "address" }),
  nativeToScVal(amount, { type: "i128" }),
  nativeToScVal(expirationLedger, { type: "u32" }),
);

const source = await server.getAccount(account.publicKey());
const tx = new TransactionBuilder(source, {
  fee: "10000000",
  networkPassphrase,
})
  .addOperation(approveOp)
  .setTimeout(30)
  .build();

const prepared = await server.prepareTransaction(tx);
prepared.sign(account);
const sent = await server.sendTransaction(prepared);
```

After this transaction is included onchain with success, the issuer contract is
allowed to transfer up to `amount` from the user's wallet account before
`expiration_ledger`.

## Limits And Recommendations

Use this section when your card flow must return an authorization decision
before the debit transaction is included onchain.

If you can wait for onchain inclusion before offchain confirmation, that is the
safer path.

### Velocity Semantics

The per-user period limit is a **fixed window**, not a sliding/rolling one.
`period_spent` is tracked against a window that re-anchors to the timestamp of
the first transfer after the previous window elapsed (see
`validate_and_update_user_velocity` in `contracts/factory/src/velocity.rs`):
once `now - period_last_reset_timestamp >= period_duration_seconds`, the spend
counter resets to zero and the window restarts from the current transfer.

A consequence is that up to ~2x `period_spend_limit` can be spent across a
single window boundary: a cardholder can spend the full limit just before a
window elapses and the full limit again immediately after the reset, within a
span shorter than `period_duration_seconds`. This is an inherent property of
fixed-window rate limiting. Size `period_spend_limit` and
`period_duration_seconds` with that boundary burst in mind, and keep
`period_duration_seconds` large enough that the per-ledger / one-transfer-per-
ledger controls remain the finer-grained limit. A very small
`period_duration_seconds` (for example `1`) makes nearly every ledger a fresh
window, collapsing the period cap to a per-ledger limit; pick a duration well
above the ledger interval.

### Limitations

1. Balance depletion before inclusion:
   you can approve an authorization while the debit transaction is pending. In
   that gap, the cardholder can move funds first. If that transaction lands
   first, the debit fails onchain.
1. No reservation semantics:
   simulation and RPC submission do not lock balance or allowance.
   They only show the debit was valid at that moment.
1. Submitted is not settled:
   submitted means "sent", not "settled". The debit is final only after it is
   included onchain with a successful result. If you confirm before that point,
   you are taking settlement risk.

### Recommendations (If You Do Not Wait For Inclusion)

1. Explicitly bound loss:
   keep per-authorization caps low and enforce strict velocity limits. Design
   limits so occasional race losses are still acceptable.
1. Use competitive fees and fee bumping:
   bid above minimum fees and support fee bump transactions so you can raise
   priority during congestion.
1. Submit immediately:
   submit the debit as soon as the authorization request passes your checks.
   Earlier submission reduces your side of the race window.
1. Use a two-check confirmation flow:
   check once at submit time and again right before offchain confirmation. If
   the debit is included and successful, confirm. If still pending, apply your
   own risk policy for offchain confirmation.
1. Require balance headroom:
   require `amount + margin` in token base units at authorization time, not
   exact amount. This filters approvals that are likely to fail at inclusion.

## Velocity Configuration

`update_user_velocity` is manager-only and validated by
`validate_velocity_config`. Keep these properties in mind when configuring a
cardholder:

1. Cross-field invariant:
   `per_transaction_spend_limit` must not exceed `period_spend_limit`. A config
   that violates this is rejected with `InvalidVelocityConfig`; without the
   check the effective single-transfer ceiling silently collapses to
   `min(per_transaction_spend_limit, period_spend_limit)`.
1. Minimum period duration:
   `period_duration_seconds` must be at least `MIN_PERIOD_DURATION_SECONDS`
   (one hour). A shorter window resets on nearly every ledger, degrading the
   period cap to a per-ledger cap. There is no upper bound: a very large
   duration is an intentional "effectively never resets" configuration that
   some operators may want, and it is visible via `get_user_velocity`.
1. Disabling a cardholder:
   there is no explicit suspend flag. A user with `per_transaction_spend_limit`
   of `0` (which the cross-field rule forces when `period_spend_limit` is `0`)
   cannot transfer at all, so `period_spend_limit = 0` is the documented freeze
   idiom. The all-zero default also means an unconfigured user is frozen until
   the manager sets limits. To revoke spending entirely, prefer
   `update_authorized_debitor(..., authorized = false)`.

## Issuer Upgrade Safety

`upgrade_issuer` (and the factory's own `upgrade`) install any 32-byte WASM hash
the owner supplies, with no on-chain verification that the hash is a valid,
working contract. A hash for WASM that has not been uploaded fails safely: the
host traps and the whole transaction reverts, leaving the issuer unchanged. The
unsafe case is a wrong-but-uploaded hash: it installs successfully, and if the
new code lacks a working factory-authorized `upgrade` entrypoint the issuer can
never be upgraded again. Recovery is not possible for that `(issuer_id, token)`
pair — `create_issuer` rejects it with `IssuerAlreadyExists`, and the
deterministic deployer salt `sha256(issuer_id, token)` collides on any redeploy,
so re-onboarding requires a new `issuer_id` and forces every cardholder to
re-approve a new issuer contract as their SEP-41 spender. This residual risk is
consistent with the owner's accepted authority to install arbitrary issuer code.

Follow this runbook for every issuer upgrade:

1. Upload the new WASM with `stellar contract upload` and record the returned
   hash.
1. Deploy that exact WASM to a throwaway contract on the same network and verify
   it exposes a working factory-authorized `upgrade` entrypoint (the fixture in
   `contracts/issuer-upgrade-fixture` exists for this purpose).
1. Only then call `upgrade_issuer` with the verified hash.
1. Treat a bad target hash as unrecoverable for that `(issuer_id, token)` pair:
   plan upgrades during a maintenance window and double-check the hash against
   step 1 before submitting.

## Event Observability

Off-chain monitoring of contract events is the operational mitigation for the
privileged owner/debitor powers, so the factory emits an event for every
state-changing entrypoint and tags the natural lookup keys as event topics so
RPC `getEvents` can filter them server-side.

- Security-critical state transitions are observable: `Paused`/`Unpaused`
  (topic: `pauser`), `OwnerUpdated` (topic: `new_owner`), `PauserUpdated`
  (topic: `new_pauser`), `ContractUpgraded`, and `IssuerUpgraded` (topic:
  `issuer_id`).
- Policy and transfer events carry their reconciliation keys as topics:
  `IssuerCreated` (`issuer_id`, `token`), `TransferExecuted` (`uuid`,
  `issuer_id`, `account`), `DestinationUpdated` (`issuer_id`, `destination`),
  `DebitorUpdated` (`issuer_id`, `debitor`), `ManagedUpdated` (`issuer_id`,
  `manager`), and `UserVelocityUpdated` (`issuer_id`, `token`, `user`).
- `TransferExecuted` records the signing `debitor` alongside the debited
  `account`, so a debit can be attributed to both a policy scope and a signer.
  `debitor` is carried in event data (not a topic) because the host caps a
  contract event at four topics including the event name, so debitor-only
  queries filter client-side.

Because Soroban events are not retained indefinitely, long-range historical
reconciliation depends on an off-chain indexer ingesting these events promptly.

## State Archival (TTL) And Rent

Soroban charges rent for ledger storage: every entry has a TTL that only an
explicit `extend_ttl` call refreshes — ordinary reads and writes do not. An
entry whose TTL lapses is archived. Since Protocol 23, archived entries are
restored automatically when the next transaction touches them (simulation adds
them to the restore list), so archival normally costs extra fees on the next
access rather than an outage — but clients that submit stale, hand-built
footprints fail until the entry is restored.

Both contracts extend TTLs on use: once an entry's remaining TTL falls below
~30 days, the next access extends it to the network maximum (~180 days on
mainnet). This covers the factory's persistent entries (issuer addresses,
managers, destination allowlist, debitor authorizations, user velocity — reads
included, since most are written once and only read afterward), the factory
instance + code entries on every state-mutating entrypoint, and each issuer's
instance + code entries on every transfer and upgrade. A deployment exercised
at least once per maximum-TTL window never archives in normal operation.

Idle state still archives: a dormant issuer's instance/code entries, the
uploaded issuer WASM (kept alive only by issuer activity; if it archives,
`create_issuer` fails until it is restored), and any long-idle persistent entry
(e.g. a dormant cardholder's velocity scope). New entries start at the network
minimum (~120 days on mainnet) and are first extended once they decay below the
~30-day threshold.

### Runbook

Monitor `liveUntilLedgerSeq` (via the `getLedgerEntries` RPC) for the factory
and issuer instance/code entries, the issuer WASM, and long-idle persistent
entries. Anyone can pay to extend or restore — no contract authorization:

```bash
# Persistent entry
stellar contract extend --id <CONTRACT_ID> --durability persistent \
  --key-xdr <ENTRY_KEY_XDR> --ledgers-to-extend <N>

# Contract instance (omit the key). Does NOT cover the code entry.
stellar contract extend --id <CONTRACT_ID> --ledgers-to-extend <N>

# Contract code, including the uploaded issuer WASM
stellar contract extend --wasm-hash <WASM_HASH> --ledgers-to-extend <N>
```

If an entry has already archived, use `stellar contract restore` with the same
key arguments.

## Acknowledgments

Portions of this implementation were adapted from Bridge Ventures / withbridge
sources:

- Solidity reference:
  `https://worldscan.org/address/0x6b0d105999491a48d5793fb6cb54f5ce079e0da9#code`
- Related project:
  `https://github.com/withbridge/bridge-cards`

See `THIRD_PARTY_NOTICES.md` for additional attribution details.
