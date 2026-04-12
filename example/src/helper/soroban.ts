import {
  TransactionBuilder,
  Keypair,
  rpc,
  xdr,
  Contract,
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
}: {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  signerKeypair: Keypair;
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

  const prepared = rpc.assembleTransaction(tx, simulated).build();

  // Sign auth entries if present
  if (simulated.result?.auth?.length) {
    const latestLedger = await server.getLatestLedger();
    const validUntilLedger = latestLedger.sequence + 100;

    const signedAuth = await Promise.all(
      simulated.result.auth.map(
        (entry: xdr.SorobanAuthorizationEntry) =>
          authorizeEntry(
            entry,
            signerKeypair,
            validUntilLedger,
            NETWORK_PASSPHRASE as typeof Networks.TESTNET,
          ),
      ),
    );

    const op = prepared
      .operations[0] as unknown as { auth: xdr.SorobanAuthorizationEntry[] };
    if (op.auth) {
      op.auth = signedAuth;
    }
  }

  prepared.sign(signerKeypair);
  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    throw new Error(`Transaction send failed: ${sendResult.errorResult}`);
  }

  return pollTransaction(server, sendResult.hash);
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
