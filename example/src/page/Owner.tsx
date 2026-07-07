import { useState, useCallback, useEffect, useRef } from "react";
import { Button, Card, Heading, Input, Text, Toggle } from "@stellar/design-system";

import { useAppState, useAppDispatch } from "@/store.ts";
import { errorMessage } from "@/helper/errors.ts";
import { hexToBytes } from "@/soroban/codec.ts";
import {
  getOwner,
  getPauser,
  setOwner,
  setPauserByOwner,
  setAuthorizedManager,
  updateIssuerDestination,
  isAuthorizedDestination,
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

  // --- Destination Allowlist ---
  const [destAddress, setDestAddress] = useState(
    state.roles.destination.keypair?.publicKey() ??
      state.destinationAddress ??
      "",
  );
  const [destAllowed, setDestAllowed] = useState(true);
  const [destLoading, setDestLoading] = useState(false);
  const [destError, setDestError] = useState("");
  const [destResult, setDestResult] = useState("");
  const [destCheckResult, setDestCheckResult] = useState<boolean | null>(null);

  const handleUpdateDestination = useCallback(async () => {
    if (!ownerKp || !state.factoryContractId || !state.issuerId) return;
    setDestLoading(true);
    setDestError("");
    setDestResult("");
    setDestCheckResult(null);
    try {
      await updateIssuerDestination({
        factoryId: state.factoryContractId,
        issuerId: hexToBytes(state.issuerId),
        destination: destAddress,
        allowed: destAllowed,
        ownerKeypair: ownerKp,
      });
      setDestResult(
        `Destination ${destAllowed ? "added to" : "removed from"} allowlist`,
      );
    } catch (e) {
      setDestError(errorMessage(e));
    } finally {
      setDestLoading(false);
    }
  }, [ownerKp, state.factoryContractId, state.issuerId, destAddress, destAllowed]);

  const handleCheckDestination = useCallback(async () => {
    if (!ownerKp || !state.factoryContractId || !state.issuerId) return;
    setDestLoading(true);
    setDestError("");
    try {
      const allowed = await isAuthorizedDestination({
        factoryId: state.factoryContractId,
        issuerId: hexToBytes(state.issuerId),
        destination: destAddress,
        callerPublicKey: ownerKp.publicKey(),
      });
      setDestCheckResult(allowed);
    } catch (e) {
      setDestError(errorMessage(e));
    } finally {
      setDestLoading(false);
    }
  }, [ownerKp, state.factoryContractId, state.issuerId, destAddress]);

  // --- Rotate Manager ---
  // Take the new manager's secret (not just an address) so the example app can
  // rotate its local manager keypair on success — keeps the Manager tab usable
  // immediately after rotation. The contract itself only needs the address.
  const [newManagerSecret, setNewManagerSecret] = useState("");
  const [newManagerSecretError, setNewManagerSecretError] = useState("");
  const [managerRotateLoading, setManagerRotateLoading] = useState(false);
  const [managerRotateError, setManagerRotateError] = useState("");
  const [managerRotateResult, setManagerRotateResult] = useState("");

  const handleSetManager = useCallback(async () => {
    if (!ownerKp || !state.factoryContractId || !state.issuerId) return;
    const validationError = getSecretKeyError(newManagerSecret);
    if (validationError) {
      setNewManagerSecretError(validationError);
      return;
    }
    setManagerRotateLoading(true);
    setManagerRotateError("");
    setManagerRotateResult("");
    try {
      const newManagerKp = importKeypair(newManagerSecret);
      const newManagerAddr = newManagerKp.publicKey();
      await setAuthorizedManager({
        factoryId: state.factoryContractId,
        issuerId: hexToBytes(state.issuerId),
        manager: newManagerAddr,
        ownerKeypair: ownerKp,
      });
      dispatch({ type: "SET_KEYPAIR", role: "manager", keypair: newManagerKp });
      setManagerRotateResult(`Manager rotated to ${newManagerAddr}`);
      setNewManagerSecret("");
    } catch (e) {
      setManagerRotateError(errorMessage(e));
    } finally {
      setManagerRotateLoading(false);
    }
  }, [
    ownerKp,
    state.factoryContractId,
    state.issuerId,
    newManagerSecret,
    dispatch,
  ]);

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

      {/* Destination Allowlist */}
      <div className="PageSection">
        <div className="PageSection__title">Destination Allowlist</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Add or remove a destination on the issuer&apos;s allowlist.
              Removal is permitted while paused; adding requires an unpaused
              contract (FIND-008 carve-out). Requires an active issuer.
            </Text>
            <Input
              id="owner-dest-address"
              fieldSize="sm"
              label="Destination Address"
              value={destAddress}
              onChange={(e) => {
                setDestAddress(e.target.value);
                setDestCheckResult(null);
              }}
              disabled={!state.issuerId}
            />
            <div className="FormRow">
              <Toggle
                id="owner-dest-allowed"
                checked={destAllowed}
                fieldSize="sm"
                onChange={() => setDestAllowed(!destAllowed)}
                disabled={!state.issuerId}
              />
              <span className={destAllowed ? "InlineSuccess" : "InlineError"}>
                {destAllowed ? "Allow" : "Remove"}
              </span>
            </div>
            <div className="FormRow">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUpdateDestination}
                isLoading={destLoading}
                disabled={!state.issuerId || !destAddress}
              >
                Submit
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                onClick={handleCheckDestination}
                isLoading={destLoading}
                disabled={!state.issuerId || !destAddress}
              >
                Check
              </Button>
              {destCheckResult !== null && (
                <Text as="p" size="xs">
                  {destCheckResult ? "Allowlisted" : "Not allowlisted"}
                </Text>
              )}
            </div>
            {destResult && <div className="InlineSuccess">{destResult}</div>}
            {destError && <div className="InlineError">{destError}</div>}
          </div>
        </Card>
      </div>

      {/* Rotate Manager */}
      <div className="PageSection">
        <div className="PageSection__title">Rotate Manager</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Replace the issuer&apos;s manager. Owner-gated and
              authority-replacing — permitted even while the contract is paused
              (incident response). Paste the new manager&apos;s secret key so
              this client can keep driving the Manager tab after rotation.
              Requires an active issuer.
            </Text>
            <Input
              id="owner-new-manager-secret"
              fieldSize="sm"
              label="New Manager Secret Key"
              placeholder="S..."
              value={newManagerSecret}
              error={newManagerSecretError}
              onChange={(e) => {
                setNewManagerSecret(e.target.value);
                setNewManagerSecretError("");
              }}
              disabled={!state.issuerId}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSetManager}
              isLoading={managerRotateLoading}
              disabled={!state.issuerId || !newManagerSecret}
            >
              Rotate Manager
            </Button>
            {managerRotateResult && (
              <div className="InlineSuccess">{managerRotateResult}</div>
            )}
            {managerRotateError && (
              <div className="InlineError">{managerRotateError}</div>
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
