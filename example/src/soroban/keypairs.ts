import { Keypair } from "@stellar/stellar-sdk";
import { FRIENDBOT_URL } from "@/soroban/client.ts";

export function generateKeypair(): Keypair {
  return Keypair.random();
}

export function importKeypair(secret: string): Keypair {
  return Keypair.fromSecret(secret);
}

export async function fundViaFriendbot(publicKey: string): Promise<void> {
  const url = `${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Friendbot funding failed: ${text}`);
  }
}
