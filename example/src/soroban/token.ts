import {
  Keypair,
  scValToNative,
} from "@stellar/stellar-sdk";
import { invokeContract, simulateContract } from "@/helper/soroban.ts";
import {
  toScValAddress,
  toScValI128,
} from "@/soroban/codec.ts";
import { nativeToScVal } from "@stellar/stellar-sdk";

export async function approveSpender({
  tokenId,
  cardholderKeypair,
  spenderAddress,
  amount,
  expirationLedger,
}: {
  tokenId: string;
  cardholderKeypair: Keypair;
  spenderAddress: string;
  amount: bigint;
  expirationLedger: number;
}): Promise<void> {
  await invokeContract({
    contractId: tokenId,
    method: "approve",
    args: [
      toScValAddress(cardholderKeypair.publicKey()),
      toScValAddress(spenderAddress),
      toScValI128(amount),
      nativeToScVal(expirationLedger, { type: "u32" }),
    ],
    signerKeypair: cardholderKeypair,
  });
}

export async function getBalance({
  tokenId,
  address,
  callerPublicKey,
}: {
  tokenId: string;
  address: string;
  callerPublicKey: string;
}): Promise<bigint> {
  const result = await simulateContract({
    contractId: tokenId,
    method: "balance",
    args: [toScValAddress(address)],
    publicKey: callerPublicKey,
  });

  return BigInt(scValToNative(result!) as string | number);
}

export async function getAllowance({
  tokenId,
  from,
  spender,
  callerPublicKey,
}: {
  tokenId: string;
  from: string;
  spender: string;
  callerPublicKey: string;
}): Promise<bigint> {
  const result = await simulateContract({
    contractId: tokenId,
    method: "allowance",
    args: [toScValAddress(from), toScValAddress(spender)],
    publicKey: callerPublicKey,
  });

  return BigInt(scValToNative(result!) as string | number);
}
