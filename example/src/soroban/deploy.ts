import {
  Keypair,
  TransactionBuilder,
  Operation,
  xdr,
  hash,
  Address,
  StrKey,
} from "@stellar/stellar-sdk";
import { getSorobanServer, NETWORK_PASSPHRASE } from "@/soroban/client.ts";
import { rpc } from "@stellar/stellar-sdk";
import { parseSimulationError } from "@/helper/errors.ts";

const BASE_FEE = "10000000";
const TIMEOUT_SEC = 30;

async function submitAndPoll(
  server: rpc.Server,
  tx: ReturnType<TransactionBuilder["build"]>,
  keypair: Keypair,
) {
  const simulated = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(parseSimulationError(simulated.error));
  }

  const prepared = rpc.assembleTransaction(tx, simulated).build();
  prepared.sign(keypair);
  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    throw new Error(`Send failed: ${sendResult.errorResult}`);
  }

  for (let i = 0; i < 30; i++) {
    const result = await server.getTransaction(sendResult.hash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED")
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error("Transaction not confirmed");
}

export async function uploadWasm({
  wasmBytes,
  signerKeypair,
}: {
  wasmBytes: Uint8Array;
  signerKeypair: Keypair;
}): Promise<string> {
  const server = getSorobanServer();
  const source = await server.getAccount(signerKeypair.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(
          Buffer.from(wasmBytes),
        ),
        auth: [],
      }),
    )
    .setTimeout(TIMEOUT_SEC)
    .build();

  await submitAndPoll(server, tx, signerKeypair);

  // WASM hash = SHA-256 of the uploaded bytes
  const wasmHash = hash(Buffer.from(wasmBytes));
  return wasmHash.toString("hex");
}

export async function deployContract({
  wasmHash,
  constructorArgs,
  signerKeypair,
  salt,
}: {
  wasmHash: string;
  constructorArgs: xdr.ScVal[];
  signerKeypair: Keypair;
  salt?: Uint8Array;
}): Promise<string> {
  const server = getSorobanServer();
  const source = await server.getAccount(signerKeypair.publicKey());

  const deploySalt = salt ?? crypto.getRandomValues(new Uint8Array(32));

  const contractIdPreimage =
    xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: Address.fromString(signerKeypair.publicKey()).toScAddress(),
        salt: Buffer.from(deploySalt),
      }),
    );

  const createContractArgs = new xdr.CreateContractArgsV2({
    contractIdPreimage,
    executable: xdr.ContractExecutable.contractExecutableWasm(
      Buffer.from(wasmHash, "hex"),
    ),
    constructorArgs,
  });

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeCreateContractV2(
          createContractArgs,
        ),
        auth: [],
      }),
    )
    .setTimeout(TIMEOUT_SEC)
    .build();

  await submitAndPoll(server, tx, signerKeypair);

  // Derive the contract ID from preimage
  const preimageXdr = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      contractIdPreimage,
    }),
  );

  const contractHash = hash(preimageXdr.toXDR());
  return StrKey.encodeContract(contractHash);
}
