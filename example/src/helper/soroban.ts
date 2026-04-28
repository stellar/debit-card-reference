import {
  TransactionBuilder,
  Keypair,
  rpc,
  xdr,
  Contract,
  Address,
  authorizeEntry,
  Networks,
} from "@stellar/stellar-sdk";
import { getSorobanServer, NETWORK_PASSPHRASE } from "@/soroban/client.ts";
import { parseSimulationError } from "@/helper/errors.ts";

const BASE_FEE = "10000000";
const TIMEOUT_SEC = 30;

export async function invokeContract({
  contractId,
  method,
  args,
  signerKeypair,
  additionalAuthSigners,
}: {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  signerKeypair: Keypair;
  additionalAuthSigners?: Keypair[];
}): Promise<xdr.ScVal | undefined> {
  const server = getSorobanServer();
  const contract = new Contract(contractId);
  const sourceAccount = await server.getAccount(
    signerKeypair.publicKey(),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TIMEOUT_SEC)
    .build();

  const simulated = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(parseSimulationError(simulated.error));
  }

  // Sign address-credentials auth entries BEFORE assembleTransaction so the
  // signed entries are baked into the assembled tx's underlying XDR. Mutating
  // `prepared.operations[0].auth` after `.build()` does NOT propagate — both
  // `signatureBase()` and `toEnvelope()` serialize from `Transaction.tx` (the
  // cached parsed XDR captured at build time), not from `operations[]`. Each
  // address-credentials entry is signed by the keypair whose public key
  // matches the credential address; this satisfies multi-signer flows (e.g.,
  // set_owner co-signature) via `additionalAuthSigners`.
  if (simulated.result?.auth?.length) {
    const latestLedger = await server.getLatestLedger();
    const validUntilLedger = latestLedger.sequence + 100;

    const authKeypairs = [signerKeypair, ...(additionalAuthSigners ?? [])];

    simulated.result.auth = await Promise.all(
      simulated.result.auth.map(
        (entry: xdr.SorobanAuthorizationEntry) =>
          signAuthEntry(entry, authKeypairs, validUntilLedger),
      ),
    );
  }

  const prepared = rpc.assembleTransaction(tx, simulated).build();

  prepared.sign(signerKeypair);
  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    throw new Error(`Transaction send failed: ${sendResult.errorResult}`);
  }

  return pollTransaction(server, sendResult.hash);
}

async function signAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  candidates: Keypair[],
  validUntilLedger: number,
): Promise<xdr.SorobanAuthorizationEntry> {
  const credentials = entry.credentials();
  // Source-account credentials are auto-satisfied by the transaction signer.
  if (
    credentials.switch() === xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()
  ) {
    return entry;
  }

  const requiredAddress = Address.fromScAddress(
    credentials.address().address(),
  ).toString();
  const signer = candidates.find((kp) => kp.publicKey() === requiredAddress);
  if (!signer) {
    throw new Error(
      `No keypair provided to sign auth entry for ${requiredAddress}`,
    );
  }

  return authorizeEntry(
    entry,
    signer,
    validUntilLedger,
    NETWORK_PASSPHRASE as typeof Networks.TESTNET,
  );
}

export async function simulateContract({
  contractId,
  method,
  args,
  publicKey,
}: {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  publicKey: string;
}): Promise<xdr.ScVal | undefined> {
  const server = getSorobanServer();
  const contract = new Contract(contractId);
  const sourceAccount = await server.getAccount(publicKey);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TIMEOUT_SEC)
    .build();

  const simulated = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(parseSimulationError(simulated.error));
  }

  if (!rpc.Api.isSimulationSuccess(simulated)) {
    throw new Error("Simulation did not succeed");
  }

  return simulated.result?.retval;
}

async function pollTransaction(
  server: rpc.Server,
  hash: string,
  maxAttempts = 30,
  intervalMs = 2000,
): Promise<xdr.ScVal | undefined> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await server.getTransaction(hash);

    if (result.status === "SUCCESS") {
      return result.returnValue;
    }

    if (result.status === "FAILED") {
      throw new Error(`Transaction failed on-chain: ${JSON.stringify(result)}`);
    }

    // NOT_FOUND means still pending
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Transaction ${hash} not confirmed after ${maxAttempts} attempts`);
}
