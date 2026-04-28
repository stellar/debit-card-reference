import { useState, useCallback, useEffect, useRef } from "react";
import { Button, Card, Heading, Input, Text } from "@stellar/design-system";

import { useAppState, useAppDispatch } from "@/store.ts";
import { errorMessage } from "@/helper/errors.ts";
import { hexToBytes } from "@/soroban/codec.ts";
import {
  getOwner,
  getPauser,
  setOwner,
  setPauserByOwner,
  upgradeFactory,
  upgradeIssuer,
} from "@/soroban/factory.ts";
import { importKeypair } from "@/soroban/keypairs.ts";
import { getSecretKeyError } from "@/helper/validation.ts";
import { uploadWasm } from "@/soroban/deploy.ts";

export const Owner = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const ownerKp = state.roles.owner.keypair;

  // --- Current owner / pauser display ---
  const [currentOwner, setCurrentOwner] = useState<string | null>(null);
  const [currentPauser, setCurrentPauser] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    if (!state.factoryContractId || !ownerKp) return;
    try {
      const [o, p] = await Promise.all([
        getOwner({
          factoryId: state.factoryContractId,
          callerPublicKey: ownerKp.publicKey(),
        }),
        getPauser({
          factoryId: state.factoryContractId,
          callerPublicKey: ownerKp.publicKey(),
        }),
      ]);
      setCurrentOwner(o);
      setCurrentPauser(p);
    } catch {
      // ignore query errors on load
    }
  }, [state.factoryContractId, ownerKp]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  // --- Transfer Ownership ---
  // The contract requires a co-signature from the new owner, so we need its
  // secret key (not just an address) to sign the auth entry.
  const [newOwnerSecret, setNewOwnerSecret] = useState("");
  const [newOwnerSecretError, setNewOwnerSecretError] = useState("");
  const [ownerTransferLoading, setOwnerTransferLoading] = useState(false);
  const [ownerTransferError, setOwnerTransferError] = useState("");
  const [ownerTransferResult, setOwnerTransferResult] = useState("");

  const handleSetOwner = useCallback(async () => {
    if (!ownerKp || !state.factoryContractId) return;
    const validationError = getSecretKeyError(newOwnerSecret);
    if (validationError) {
      setNewOwnerSecretError(validationError);
      return;
    }
    setOwnerTransferLoading(true);
    setOwnerTransferError("");
    setOwnerTransferResult("");
    try {
      const newOwnerKp = importKeypair(newOwnerSecret);
      await setOwner({
        factoryId: state.factoryContractId,
        ownerKeypair: ownerKp,
        newOwnerKeypair: newOwnerKp,
      });
      const newOwnerAddr = newOwnerKp.publicKey();
      // Rotate the local owner keypair so subsequent owner-only calls sign
      // from the new on-chain owner. Without this, the next call would still
      // use the old keypair as the source account and fail
      // `current_owner.require_auth()`.
      dispatch({ type: "SET_KEYPAIR", role: "owner", keypair: newOwnerKp });
      setOwnerTransferResult(`Ownership transferred to ${newOwnerAddr}`);
      setCurrentOwner(newOwnerAddr);
      setNewOwnerSecret("");
    } catch (e) {
      setOwnerTransferError(errorMessage(e));
    } finally {
      setOwnerTransferLoading(false);
    }
  }, [ownerKp, state.factoryContractId, newOwnerSecret, dispatch]);

  // --- Transfer Pauser Role (as owner) ---
  // Take the new pauser's secret (not just an address) so the example app can
  // rotate its local pauser keypair on success — keeps the Pauser tab usable
  // immediately after rotation. The contract itself only needs the address.
  const [newPauserSecret, setNewPauserSecret] = useState("");
  const [newPauserSecretError, setNewPauserSecretError] = useState("");
  const [pauserTransferLoading, setPauserTransferLoading] = useState(false);
  const [pauserTransferError, setPauserTransferError] = useState("");
  const [pauserTransferResult, setPauserTransferResult] = useState("");

  const handleSetPauser = useCallback(async () => {
    if (!ownerKp || !state.factoryContractId) return;
    const validationError = getSecretKeyError(newPauserSecret);
    if (validationError) {
      setNewPauserSecretError(validationError);
      return;
    }
    setPauserTransferLoading(true);
    setPauserTransferError("");
    setPauserTransferResult("");
    try {
      const newPauserKp = importKeypair(newPauserSecret);
      const newPauserAddr = newPauserKp.publicKey();
      await setPauserByOwner({
        factoryId: state.factoryContractId,
        newPauser: newPauserAddr,
        ownerKeypair: ownerKp,
      });
      dispatch({ type: "SET_KEYPAIR", role: "pauser", keypair: newPauserKp });
      setPauserTransferResult(`Pauser role transferred to ${newPauserAddr}`);
      setCurrentPauser(newPauserAddr);
      setNewPauserSecret("");
    } catch (e) {
      setPauserTransferError(errorMessage(e));
    } finally {
      setPauserTransferLoading(false);
    }
  }, [ownerKp, state.factoryContractId, newPauserSecret, dispatch]);

  // --- Upgrade Factory ---
  const factoryWasmRef = useRef<HTMLInputElement>(null);
  const [factoryUpgradeLoading, setFactoryUpgradeLoading] = useState(false);
  const [factoryUpgradeError, setFactoryUpgradeError] = useState("");
  const [factoryUpgradeResult, setFactoryUpgradeResult] = useState("");

  const handleUpgradeFactory = useCallback(async () => {
    if (!ownerKp || !state.factoryContractId) return;
    const file = factoryWasmRef.current?.files?.[0];
    if (!file) {
      setFactoryUpgradeError("Select a factory WASM file first");
      return;
    }
    setFactoryUpgradeLoading(true);
    setFactoryUpgradeError("");
    setFactoryUpgradeResult("");
    try {
      const wasmBytes = new Uint8Array(await file.arrayBuffer());
      const wasmHash = await uploadWasm({
        wasmBytes,
        signerKeypair: ownerKp,
      });
      await upgradeFactory({
        factoryId: state.factoryContractId,
        newWasmHash: hexToBytes(wasmHash),
        ownerKeypair: ownerKp,
      });
      setFactoryUpgradeResult(
        `Factory upgraded (WASM hash: ${wasmHash.slice(0, 16)}...)`,
      );
    } catch (e) {
      setFactoryUpgradeError(errorMessage(e));
    } finally {
      setFactoryUpgradeLoading(false);
    }
  }, [ownerKp, state.factoryContractId]);

  // --- Upgrade Issuer ---
  const issuerWasmRef = useRef<HTMLInputElement>(null);
  const [issuerUpgradeLoading, setIssuerUpgradeLoading] = useState(false);
  const [issuerUpgradeError, setIssuerUpgradeError] = useState("");
  const [issuerUpgradeResult, setIssuerUpgradeResult] = useState("");

  const handleUpgradeIssuer = useCallback(async () => {
    if (
      !ownerKp ||
      !state.factoryContractId ||
      !state.issuerId ||
      !state.tokenContractId
    )
      return;
    const file = issuerWasmRef.current?.files?.[0];
    if (!file) {
      setIssuerUpgradeError("Select an issuer WASM file first");
      return;
    }
    setIssuerUpgradeLoading(true);
    setIssuerUpgradeError("");
    setIssuerUpgradeResult("");
    try {
      const wasmBytes = new Uint8Array(await file.arrayBuffer());
      const wasmHash = await uploadWasm({
        wasmBytes,
        signerKeypair: ownerKp,
      });
      await upgradeIssuer({
        factoryId: state.factoryContractId,
        issuerId: hexToBytes(state.issuerId),
        token: state.tokenContractId,
        newWasmHash: hexToBytes(wasmHash),
        ownerKeypair: ownerKp,
      });
      setIssuerUpgradeResult(
        `Issuer upgraded (WASM hash: ${wasmHash.slice(0, 16)}...)`,
      );
    } catch (e) {
      setIssuerUpgradeError(errorMessage(e));
    } finally {
      setIssuerUpgradeLoading(false);
    }
  }, [ownerKp, state.factoryContractId, state.issuerId, state.tokenContractId]);

  return (
    <div>
      <Heading as="h1" size="md">
        Owner
      </Heading>
      <Text as="p" size="sm">
        Manage contract ownership, pauser role, and upgrades.
      </Text>

      {/* Current Roles */}
      <div className="PageSection">
        <div className="PageSection__title">Current Roles</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="sm">
              Owner:{" "}
              <strong>{currentOwner ?? "Loading..."}</strong>
            </Text>
            <Text as="p" size="sm">
              Pauser:{" "}
              <strong>{currentPauser ?? "Loading..."}</strong>
            </Text>
            <Button size="sm" variant="tertiary" onClick={fetchRoles}>
              Refresh
            </Button>
          </div>
        </Card>
      </div>

      {/* Transfer Ownership */}
      <div className="PageSection">
        <div className="PageSection__title">Transfer Ownership</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              The contract requires a co-signature from the new owner to
              prevent ownership being lost to an unreachable address. Paste the
              new owner&apos;s secret key so this client can co-sign.
            </Text>
            <Input
              id="owner-new-owner-secret"
              fieldSize="sm"
              label="New Owner Secret Key"
              placeholder="S..."
              value={newOwnerSecret}
              error={newOwnerSecretError}
              onChange={(e) => {
                setNewOwnerSecret(e.target.value);
                setNewOwnerSecretError("");
              }}
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={handleSetOwner}
              isLoading={ownerTransferLoading}
              disabled={!newOwnerSecret}
            >
              Transfer Ownership
            </Button>
            {ownerTransferResult && (
              <div className="InlineSuccess">{ownerTransferResult}</div>
            )}
            {ownerTransferError && (
              <div className="InlineError">{ownerTransferError}</div>
            )}
          </div>
        </Card>
      </div>

      {/* Transfer Pauser Role */}
      <div className="PageSection">
        <div className="PageSection__title">Transfer Pauser Role</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              As the owner, you can rotate the pauser even when the contract is
              paused. This is the recovery path for a compromised pauser key.
              Paste the new pauser&apos;s secret key so this client can drive
              the Pauser tab as the new pauser.
            </Text>
            <Input
              id="owner-new-pauser-secret"
              fieldSize="sm"
              label="New Pauser Secret Key"
              placeholder="S..."
              value={newPauserSecret}
              error={newPauserSecretError}
              onChange={(e) => {
                setNewPauserSecret(e.target.value);
                setNewPauserSecretError("");
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSetPauser}
              isLoading={pauserTransferLoading}
              disabled={!newPauserSecret}
            >
              Transfer Pauser Role
            </Button>
            {pauserTransferResult && (
              <div className="InlineSuccess">{pauserTransferResult}</div>
            )}
            {pauserTransferError && (
              <div className="InlineError">{pauserTransferError}</div>
            )}
          </div>
        </Card>
      </div>

      {/* Upgrade Factory */}
      <div className="PageSection">
        <div className="PageSection__title">Upgrade Factory Contract</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Upload a new factory WASM to upgrade the contract in-place. The
              contract address and all storage are preserved.
            </Text>
            <input
              ref={factoryWasmRef}
              type="file"
              accept=".wasm"
              className="FileInput"
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={handleUpgradeFactory}
              isLoading={factoryUpgradeLoading}
            >
              Upload &amp; Upgrade Factory
            </Button>
            {factoryUpgradeResult && (
              <div className="InlineSuccess">{factoryUpgradeResult}</div>
            )}
            {factoryUpgradeError && (
              <div className="InlineError">{factoryUpgradeError}</div>
            )}
          </div>
        </Card>
      </div>

      {/* Upgrade Issuer */}
      <div className="PageSection">
        <div className="PageSection__title">Upgrade Issuer Contract</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Upload a new issuer WASM to upgrade the issuer contract for the
              current (issuer_id, token) pair. Requires an active issuer.
            </Text>
            <input
              ref={issuerWasmRef}
              type="file"
              accept=".wasm"
              className="FileInput"
              disabled={!state.issuerId || !state.tokenContractId}
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={handleUpgradeIssuer}
              isLoading={issuerUpgradeLoading}
              disabled={!state.issuerId || !state.tokenContractId}
            >
              Upload &amp; Upgrade Issuer
            </Button>
            {issuerUpgradeResult && (
              <div className="InlineSuccess">{issuerUpgradeResult}</div>
            )}
            {issuerUpgradeError && (
              <div className="InlineError">{issuerUpgradeError}</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
