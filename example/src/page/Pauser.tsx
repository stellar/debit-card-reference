import { useState, useCallback, useEffect } from "react";
import { Button, Card, Heading, Input, Text } from "@stellar/design-system";

import { useAppState } from "@/store.ts";
import { errorMessage } from "@/helper/errors.ts";
import {
  isPaused,
  pauseFactory,
  unpauseFactory,
  getPauser,
  setPauser,
} from "@/soroban/factory.ts";

export const Pauser = () => {
  const state = useAppState();
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
      setCurrentPauser(pauserAddr);
    } catch {
      // ignore query errors
    }
  }, [state.factoryContractId, pauserKp]);

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
      setResult("Contract paused");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, [pauserKp, state.factoryContractId]);

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
      setResult("Contract unpaused");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsLoading(false);
    }
  }, [pauserKp, state.factoryContractId]);

  // --- Transfer Pauser Role (as pauser) ---
  const [newPauserAddr, setNewPauserAddr] = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferResult, setTransferResult] = useState("");

  const handleTransferPauser = useCallback(async () => {
    if (!pauserKp || !state.factoryContractId) return;
    setTransferLoading(true);
    setTransferError("");
    setTransferResult("");
    try {
      await setPauser({
        factoryId: state.factoryContractId,
        caller: pauserKp.publicKey(),
        newPauser: newPauserAddr,
        callerKeypair: pauserKp,
      });
      setTransferResult(`Pauser role transferred to ${newPauserAddr}`);
      setCurrentPauser(newPauserAddr);
    } catch (e) {
      setTransferError(errorMessage(e));
    } finally {
      setTransferLoading(false);
    }
  }, [pauserKp, state.factoryContractId, newPauserAddr]);

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
              Rotate the pauser to a new address. This call is blocked when the
              contract is paused (use the Owner tab to recover from a
              compromised pauser).
            </Text>
            <Input
              id="pauser-new-addr"
              fieldSize="sm"
              label="New Pauser Address"
              placeholder="G..."
              value={newPauserAddr}
              onChange={(e) => setNewPauserAddr(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleTransferPauser}
              isLoading={transferLoading}
              disabled={!newPauserAddr}
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
