import { useState, useCallback, useEffect } from "react";
import { Button, Card, Heading, Input, Text } from "@stellar/design-system";

import { useAppState, useAppDispatch } from "@/store.ts";
import { errorMessage } from "@/helper/errors.ts";
import {
  isPaused,
  pauseFactory,
  unpauseFactory,
  getPauser,
  setPauserByPauser,
} from "@/soroban/factory.ts";
import { importKeypair } from "@/soroban/keypairs.ts";
import { getSecretKeyError } from "@/helper/validation.ts";

export const Pauser = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const pauserKp = state.roles.pauser.keypair;

  const [paused, setPausedState] = useState<boolean | null>(null);
  const [currentPauser, setCurrentPauser] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const fetchStatus = useCallback(async () => {
    if (!state.factoryContractId || !pauserKp) return;
    try {
      const [status, pauserAddr] = await Promise.all([
        isPaused({
          factoryId: state.factoryContractId,
          callerPublicKey: pauserKp.publicKey(),
        }),
        getPauser({
          factoryId: state.factoryContractId,
          callerPublicKey: pauserKp.publicKey(),
        }),
      ]);
      setPausedState(status);
      dispatch({ type: "SET_PAUSED", paused: status });
      setCurrentPauser(pauserAddr);
    } catch {
      // ignore query errors
    }
  }, [state.factoryContractId, pauserKp, dispatch]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handlePause = useCallback(async () => {
    if (!pauserKp || !state.factoryContractId) return;
    setIsLoading(true);
    setError("");
    setResult("");
    try {
      await pauseFactory({
        factoryId: state.factoryContractId,
        pauserKeypair: pauserKp,
      });
      setPausedState(true);
      dispatch({ type: "SET_PAUSED", paused: true });
      setResult("Contract paused");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, [pauserKp, state.factoryContractId, dispatch]);

  const handleUnpause = useCallback(async () => {
    if (!pauserKp || !state.factoryContractId) return;
    setIsLoading(true);
    setError("");
    setResult("");
    try {
      await unpauseFactory({
        factoryId: state.factoryContractId,
        pauserKeypair: pauserKp,
      });
      setPausedState(false);
      dispatch({ type: "SET_PAUSED", paused: false });
      setResult("Contract unpaused");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, [pauserKp, state.factoryContractId, dispatch]);

  // --- Transfer Pauser Role (as pauser) ---
  // Take the new pauser's secret (not just an address) so the example app can
  // rotate its local pauser keypair on success — keeps this tab usable
  // immediately after rotation. The contract itself only needs the address.
  const [newPauserSecret, setNewPauserSecret] = useState("");
  const [newPauserSecretError, setNewPauserSecretError] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferResult, setTransferResult] = useState("");

  const handleTransferPauser = useCallback(async () => {
    if (!pauserKp || !state.factoryContractId) return;
    const validationError = getSecretKeyError(newPauserSecret);
    if (validationError) {
      setNewPauserSecretError(validationError);
      return;
    }
    setTransferLoading(true);
    setTransferError("");
    setTransferResult("");
    try {
      const newPauserKp = importKeypair(newPauserSecret);
      const newPauserAddr = newPauserKp.publicKey();
      await setPauserByPauser({
        factoryId: state.factoryContractId,
        newPauser: newPauserAddr,
        pauserKeypair: pauserKp,
      });
      dispatch({ type: "SET_KEYPAIR", role: "pauser", keypair: newPauserKp });
      setTransferResult(`Pauser role transferred to ${newPauserAddr}`);
      setCurrentPauser(newPauserAddr);
      setNewPauserSecret("");
    } catch (e) {
      setTransferError(errorMessage(e));
    } finally {
      setTransferLoading(false);
    }
  }, [pauserKp, state.factoryContractId, newPauserSecret, dispatch]);

  return (
    <div>
      <Heading as="h1" size="md">
        Pauser
      </Heading>
      <Text as="p" size="sm">
        Emergency pause and unpause the factory contract. Rotate the pauser
        role.
      </Text>

      <div className="PageSection">
        <div className="PageSection__title">Contract Pause Status</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="sm">
              Status:{" "}
              <strong>
                {paused === null
                  ? "Loading..."
                  : paused
                    ? "PAUSED"
                    : "Active"}
              </strong>
            </Text>
            <Text as="p" size="sm">
              Current Pauser:{" "}
              <strong>{currentPauser ?? "Loading..."}</strong>
            </Text>
            <div className="FormRow">
              <Button
                size="sm"
                variant="destructive"
                onClick={handlePause}
                isLoading={isLoading}
                disabled={paused === true}
              >
                Pause
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUnpause}
                isLoading={isLoading}
                disabled={paused === false}
              >
                Unpause
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                onClick={fetchStatus}
              >
                Refresh
              </Button>
            </div>
            {result && <div className="InlineSuccess">{result}</div>}
            {error && <div className="InlineError">{error}</div>}
          </div>
        </Card>
      </div>

      <div className="PageSection">
        <div className="PageSection__title">Transfer Pauser Role</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Rotate the pauser to a new keypair. This call is blocked when the
              contract is paused (use the Owner tab to recover from a
              compromised pauser). Paste the new pauser&apos;s secret key so
              this tab keeps working as the new pauser.
            </Text>
            <Text as="p" size="xs">
              Note: authority-reducing operations elsewhere (revoke debitor,
              remove destination, rotate manager) now work while paused, so
              freeze-then-revoke is a single incident window.
            </Text>
            <Input
              id="pauser-new-secret"
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
              onClick={handleTransferPauser}
              isLoading={transferLoading}
              disabled={!newPauserSecret}
            >
              Transfer Pauser Role
            </Button>
            {transferResult && (
              <div className="InlineSuccess">{transferResult}</div>
            )}
            {transferError && (
              <div className="InlineError">{transferError}</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
