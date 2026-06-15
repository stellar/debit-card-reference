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
  positive amount, per-transaction limit, rolling-period limit,
  and one transfer per ledger

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

## Acknowledgments

Portions of this implementation were adapted from Bridge Ventures / withbridge
sources:

- Solidity reference:
  `https://worldscan.org/address/0x6b0d105999491a48d5793fb6cb54f5ce079e0da9#code`
- Related project:
  `https://github.com/withbridge/bridge-cards`

See `THIRD_PARTY_NOTICES.md` for additional attribution details.
