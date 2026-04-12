import { Keypair, Address, scValToNative } from "@stellar/stellar-sdk";
import { invokeContract, simulateContract } from "@/helper/soroban.ts";
import {
  toScValBytes32,
  toScValAddress,
  toScValI128,
  toScValU64,
  toScValBool,
} from "@/soroban/codec.ts";

// ─── Owner functions ─────────────────────────────────────────────────────────

export async function createIssuer({
  factoryId,
  issuerId,
  token,
  manager,
  destination,
  ownerKeypair,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  token: string;
  manager: string;
  destination: string;
  ownerKeypair: Keypair;
}): Promise<string> {
  const result = await invokeContract({
    contractId: factoryId,
    method: "create_issuer",
    args: [
      toScValBytes32(issuerId),
      toScValAddress(token),
      toScValAddress(manager),
      toScValAddress(destination),
    ],
    signerKeypair: ownerKeypair,
  });

  return Address.fromScVal(result!).toString();
}

export async function updateIssuerDestination({
  factoryId,
  issuerId,
  destination,
  allowed,
  ownerKeypair,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  destination: string;
  allowed: boolean;
  ownerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "update_issuer_destination",
    args: [
      toScValBytes32(issuerId),
      toScValAddress(destination),
      toScValBool(allowed),
    ],
    signerKeypair: ownerKeypair,
  });
}

export async function setAuthorizedManager({
  factoryId,
  issuerId,
  manager,
  ownerKeypair,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  manager: string;
  ownerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "set_authorized_manager",
    args: [toScValBytes32(issuerId), toScValAddress(manager)],
    signerKeypair: ownerKeypair,
  });
}

export async function setOwner({
  factoryId,
  newOwner,
  ownerKeypair,
}: {
  factoryId: string;
  newOwner: string;
  ownerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "set_owner",
    args: [toScValAddress(newOwner)],
    signerKeypair: ownerKeypair,
  });
}

export async function setPauser({
  factoryId,
  caller,
  newPauser,
  callerKeypair,
}: {
  factoryId: string;
  caller: string;
  newPauser: string;
  callerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "set_pauser",
    args: [toScValAddress(caller), toScValAddress(newPauser)],
    signerKeypair: callerKeypair,
  });
}

export async function upgradeFactory({
  factoryId,
  newWasmHash,
  ownerKeypair,
}: {
  factoryId: string;
  newWasmHash: Uint8Array;
  ownerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "upgrade",
    args: [toScValBytes32(newWasmHash)],
    signerKeypair: ownerKeypair,
  });
}

export async function upgradeIssuer({
  factoryId,
  issuerId,
  token,
  newWasmHash,
  ownerKeypair,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  token: string;
  newWasmHash: Uint8Array;
  ownerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "upgrade_issuer",
    args: [
      toScValBytes32(issuerId),
      toScValAddress(token),
      toScValBytes32(newWasmHash),
    ],
    signerKeypair: ownerKeypair,
  });
}

// ─── Manager functions ───────────────────────────────────────────────────────

export async function updateAuthorizedDebitor({
  factoryId,
  issuerId,
  debitor,
  authorized,
  managerKeypair,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  debitor: string;
  authorized: boolean;
  managerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "update_authorized_debitor",
    args: [
      toScValBytes32(issuerId),
      toScValAddress(debitor),
      toScValBool(authorized),
    ],
    signerKeypair: managerKeypair,
  });
}

export async function updateUserVelocity({
  factoryId,
  issuerId,
  token,
  user,
  periodDurationSeconds,
  periodSpendLimit,
  perTransactionSpendLimit,
  managerKeypair,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  token: string;
  user: string;
  periodDurationSeconds: bigint;
  periodSpendLimit: bigint;
  perTransactionSpendLimit: bigint;
  managerKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "update_user_velocity",
    args: [
      toScValBytes32(issuerId),
      toScValAddress(token),
      toScValAddress(user),
      toScValU64(periodDurationSeconds),
      toScValI128(periodSpendLimit),
      toScValI128(perTransactionSpendLimit),
    ],
    signerKeypair: managerKeypair,
  });
}

// ─── Debitor functions ───────────────────────────────────────────────────────

export async function transferToDestination({
  factoryId,
  issuerId,
  token,
  debitor,
  account,
  amount,
  destination,
  uuid,
  debitorKeypair,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  token: string;
  debitor: string;
  account: string;
  amount: bigint;
  destination: string;
  uuid: Uint8Array;
  debitorKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "transfer_to_destination",
    args: [
      toScValBytes32(issuerId),
      toScValAddress(token),
      toScValAddress(debitor),
      toScValAddress(account),
      toScValI128(amount),
      toScValAddress(destination),
      toScValBytes32(uuid),
    ],
    signerKeypair: debitorKeypair,
  });
}

// ─── Pauser functions ────────────────────────────────────────────────────────

export async function pauseFactory({
  factoryId,
  pauserKeypair,
}: {
  factoryId: string;
  pauserKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "pause",
    args: [],
    signerKeypair: pauserKeypair,
  });
}

export async function unpauseFactory({
  factoryId,
  pauserKeypair,
}: {
  factoryId: string;
  pauserKeypair: Keypair;
}): Promise<void> {
  await invokeContract({
    contractId: factoryId,
    method: "unpause",
    args: [],
    signerKeypair: pauserKeypair,
  });
}

// ─── Read-only queries ───────────────────────────────────────────────────────

export async function getOwner({
  factoryId,
  callerPublicKey,
}: {
  factoryId: string;
  callerPublicKey: string;
}): Promise<string> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "get_owner",
    args: [],
    publicKey: callerPublicKey,
  });

  return Address.fromScVal(result!).toString();
}

export async function getPauser({
  factoryId,
  callerPublicKey,
}: {
  factoryId: string;
  callerPublicKey: string;
}): Promise<string> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "get_pauser",
    args: [],
    publicKey: callerPublicKey,
  });

  return Address.fromScVal(result!).toString();
}

export async function getIssuerAddress({
  factoryId,
  issuerId,
  token,
  callerPublicKey,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  token: string;
  callerPublicKey: string;
}): Promise<string> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "get_issuer_address",
    args: [toScValBytes32(issuerId), toScValAddress(token)],
    publicKey: callerPublicKey,
  });

  return Address.fromScVal(result!).toString();
}

export async function isPaused({
  factoryId,
  callerPublicKey,
}: {
  factoryId: string;
  callerPublicKey: string;
}): Promise<boolean> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "paused",
    args: [],
    publicKey: callerPublicKey,
  });

  return scValToNative(result!) as boolean;
}

export async function isAuthorizedDebitor({
  factoryId,
  issuerId,
  debitor,
  callerPublicKey,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  debitor: string;
  callerPublicKey: string;
}): Promise<boolean> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "is_authorized_debitor",
    args: [toScValBytes32(issuerId), toScValAddress(debitor)],
    publicKey: callerPublicKey,
  });

  return scValToNative(result!) as boolean;
}

export async function isAuthorizedManager({
  factoryId,
  issuerId,
  manager,
  callerPublicKey,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  manager: string;
  callerPublicKey: string;
}): Promise<boolean> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "is_authorized_manager",
    args: [toScValBytes32(issuerId), toScValAddress(manager)],
    publicKey: callerPublicKey,
  });

  return scValToNative(result!) as boolean;
}

export async function isAuthorizedDestination({
  factoryId,
  issuerId,
  destination,
  callerPublicKey,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  destination: string;
  callerPublicKey: string;
}): Promise<boolean> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "is_authorized_destination",
    args: [toScValBytes32(issuerId), toScValAddress(destination)],
    publicKey: callerPublicKey,
  });

  return scValToNative(result!) as boolean;
}

export interface UserVelocityResult {
  period_duration_seconds: bigint;
  period_spend_limit: bigint;
  per_transaction_spend_limit: bigint;
  period_spent: bigint;
  period_last_reset_timestamp: bigint;
  ledger_last_spent: number;
  has_spent: boolean;
}

export async function getUserVelocity({
  factoryId,
  issuerId,
  token,
  user,
  callerPublicKey,
}: {
  factoryId: string;
  issuerId: Uint8Array;
  token: string;
  user: string;
  callerPublicKey: string;
}): Promise<UserVelocityResult> {
  const result = await simulateContract({
    contractId: factoryId,
    method: "get_user_velocity",
    args: [
      toScValBytes32(issuerId),
      toScValAddress(token),
      toScValAddress(user),
    ],
    publicKey: callerPublicKey,
  });

  const native = scValToNative(result!) as Record<string, unknown>;

  return {
    period_duration_seconds: BigInt(
      native.period_duration_seconds as string | number,
    ),
    period_spend_limit: BigInt(native.period_spend_limit as string | number),
    per_transaction_spend_limit: BigInt(
      native.per_transaction_spend_limit as string | number,
    ),
    period_spent: BigInt(native.period_spent as string | number),
    period_last_reset_timestamp: BigInt(
      native.period_last_reset_timestamp as string | number,
    ),
    ledger_last_spent: Number(native.ledger_last_spent),
    has_spent: native.has_spent as boolean,
  };
}
