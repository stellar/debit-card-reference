import { useState, useCallback } from "react";
import { Button, Card, Heading, Input, Text, Toggle } from "@stellar/design-system";

import { useAppState } from "@/store.ts";
import { hexToBytes } from "@/soroban/codec.ts";
import {
  updateAuthorizedDebitor,
  updateUserVelocity,
} from "@/soroban/factory.ts";
import { errorMessage } from "@/helper/errors.ts";
import { parseAmount, amountLabel, useConvertOnUnitChange } from "@/helper/units.ts";

export const Manager = () => {
  const state = useAppState();
  const managerKp = state.roles.manager.keypair;
  const units = state.displayUnits;
  const debitorPub = state.roles.debitor.keypair?.publicKey() ?? "";
  const cardholderPub = state.roles.cardholder.keypair?.publicKey() ?? "";

  // Authorize Debitor
  const [debitorAddress, setDebitorAddress] = useState(debitorPub);
  const [debitorAuthorized, setDebitorAuthorized] = useState(true);
  const [isAuthDebitor, setIsAuthDebitor] = useState(false);
  const [authDebitorResult, setAuthDebitorResult] = useState("");
  const [authDebitorError, setAuthDebitorError] = useState("");

  // Velocity
  const [velocityUser, setVelocityUser] = useState(cardholderPub);
  const [periodSeconds, setPeriodSeconds] = useState("86400");
  const [periodLimit, setPeriodLimit] = useState("10000000000");
  const [txLimit, setTxLimit] = useState("1000000000");
  const [isSettingVelocity, setIsSettingVelocity] = useState(false);
  const [velocityResult, setVelocityResult] = useState("");
  const [velocityError, setVelocityError] = useState("");

  useConvertOnUnitChange(units, setPeriodLimit, setTxLimit);

  const handleAuthDebitor = useCallback(async () => {
    if (!managerKp || !state.factoryContractId || !state.issuerId) return;
    setIsAuthDebitor(true);
    setAuthDebitorError("");
    setAuthDebitorResult("");
    try {
      await updateAuthorizedDebitor({
        factoryId: state.factoryContractId,
        issuerId: hexToBytes(state.issuerId),
        debitor: debitorAddress,
        authorized: debitorAuthorized,
        managerKeypair: managerKp,
      });
      setAuthDebitorResult(
        `Debitor ${debitorAuthorized ? "authorized" : "revoked"} successfully`,
      );
    } catch (e) {
      setAuthDebitorError(errorMessage(e));
    } finally {
      setIsAuthDebitor(false);
    }
  }, [managerKp, state.factoryContractId, state.issuerId, debitorAddress, debitorAuthorized]);

  const handleSetVelocity = useCallback(async () => {
    if (
      !managerKp ||
      !state.factoryContractId ||
      !state.issuerId ||
      !state.tokenContractId
    )
      return;
    setIsSettingVelocity(true);
    setVelocityError("");
    setVelocityResult("");
    try {
      await updateUserVelocity({
        factoryId: state.factoryContractId,
        issuerId: hexToBytes(state.issuerId),
        token: state.tokenContractId,
        user: velocityUser,
        periodDurationSeconds: BigInt(periodSeconds),
        periodSpendLimit: parseAmount(periodLimit, units),
        perTransactionSpendLimit: parseAmount(txLimit, units),
        managerKeypair: managerKp,
      });
      setVelocityResult("Velocity limits updated successfully");
    } catch (e) {
      setVelocityError(errorMessage(e));
    } finally {
      setIsSettingVelocity(false);
    }
  }, [
    managerKp,
    state.factoryContractId,
    state.issuerId,
    state.tokenContractId,
    velocityUser,
    periodSeconds,
    periodLimit,
    txLimit,
    units,
  ]);

  return (
    <div>
      <Heading as="h1" size="md">
        Manager
      </Heading>
      <Text as="p" size="sm">
        Authorize debitors and configure velocity limits for cardholders.
      </Text>

      {/* Authorize Debitor */}
      <div className="PageSection">
        <div className="PageSection__title">Authorize Debitor</div>
        <Card>
          <div className="FormStack">
            <Input
              id="debitor-addr"
              fieldSize="sm"
              label="Debitor Address"
              value={debitorAddress}
              onChange={(e) => setDebitorAddress(e.target.value)}
            />
            <div className="FormRow">
              <Toggle
                id="debitor-authorized"
                checked={debitorAuthorized}
                fieldSize="sm"
                onChange={() => setDebitorAuthorized(!debitorAuthorized)}
              />
              <span className={debitorAuthorized ? "InlineSuccess" : "InlineError"}>
                {debitorAuthorized ? "Authorize" : "Revoke"}
              </span>
            </div>
            <Text as="p" size="xs">
              Revoking (authorized = false) is permitted while the contract is
              paused; authorizing requires an unpaused contract (FIND-008
              carve-out).
            </Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleAuthDebitor}
              isLoading={isAuthDebitor}
            >
              Submit
            </Button>
            {authDebitorResult && (
              <div className="InlineSuccess">{authDebitorResult}</div>
            )}
            {authDebitorError && (
              <div className="InlineError">{authDebitorError}</div>
            )}
          </div>
        </Card>
      </div>

      {/* Set Velocity */}
      <div className="PageSection">
        <div className="PageSection__title">Set Velocity Limits</div>
        <Card>
          <div className="FormStack">
            <Input
              id="velocity-user"
              fieldSize="sm"
              label="User (Cardholder) Address"
              value={velocityUser}
              onChange={(e) => setVelocityUser(e.target.value)}
            />
            <Input
              id="period-seconds"
              fieldSize="sm"
              label="Period Duration (seconds)"
              value={periodSeconds}
              onChange={(e) => setPeriodSeconds(e.target.value)}
              note="86400 = 24 hours; must be ≥ 3600 (one hour) — smaller values are rejected on-chain"
            />
            <Input
              id="period-limit"
              fieldSize="sm"
              label={amountLabel("Period Spend Limit", units)}
              value={periodLimit}
              onChange={(e) => setPeriodLimit(e.target.value)}
            />
            <Input
              id="tx-limit"
              fieldSize="sm"
              label={amountLabel("Per-Transaction Limit", units)}
              value={txLimit}
              onChange={(e) => setTxLimit(e.target.value)}
              note="must not exceed Period Spend Limit; both must be ≥ 0"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSetVelocity}
              isLoading={isSettingVelocity}
            >
              Set Velocity
            </Button>
            {velocityResult && (
              <div className="InlineSuccess">{velocityResult}</div>
            )}
            {velocityError && (
              <div className="InlineError">{velocityError}</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
