import { StrKey } from "@stellar/stellar-sdk";

export const getSecretKeyError = (mk: string) => {
  if (!mk) {
    return "Master key is required.";
  }

  if (!StrKey.isValidEd25519SecretSeed(mk)) {
    return "Master key is invalid.";
  }

  return "";
};

export const getPublicKeyError = (pk: string) => {
  if (!pk) {
    return "Public key is required.";
  }

  if (!StrKey.isValidEd25519PublicKey(pk)) {
    return "Public key is invalid.";
  }

  return "";
};
