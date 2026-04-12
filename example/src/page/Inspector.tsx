import { useState, useCallback } from "react";
import { Button, Card, Heading, Input, Text } from "@stellar/design-system";

import { useAppState } from "@/store.ts";
import { errorMessage } from "@/helper/errors.ts";
import { formatAmount, unitSuffix } from "@/helper/units.ts";
import { hexToBytes } from "@/soroban/codec.ts";
import {
  getIssuerAddress,
  isAuthorizedDebitor,
  isAuthorizedManager,
  isAuthorizedDestination,
  getUserVelocity,
  isPaused,
  getOwner,
  getPauser,
} from "@/soroban/factory.ts";
import type { UserVelocityResult } from "@/soroban/factory.ts";
import { getBalance } from "@/soroban/token.ts";

export const Inspector = () => {
  const state = useAppState();
  const units = state.displayUnits;
  const callerPublicKey =
    state.roles.owner.keypair?.publicKey() ??
    state.roles.manager.keypair?.publicKey() ??
    "";

  // Issuer address query
  const [issuerQueryToken, setIssuerQueryToken] = useState(
    state.tokenContractId ?? "",
  );
  const [issuerQueryId, setIssuerQueryId] = useState(state.issuerId ?? "");
  const [issuerAddressResult, setIssuerAddressResult] = useState("");

  // Authorization queries
  const [authDebitorAddr, setAuthDebitorAddr] = useState(
    state.roles.debitor.keypair?.publicKey() ?? "",
  );
  const [authDebitorResult, setAuthDebitorResult] = useState<boolean | null>(
    null,
  );
  const [authManagerAddr, setAuthManagerAddr] = useState(
    state.roles.manager.keypair?.publicKey() ?? "",
  );
  const [authManagerResult, setAuthManagerResult] = useState<boolean | null>(
    null,
  );
  const [authDestAddr, setAuthDestAddr] = useState(
    state.destinationAddress ?? "",
  );
  const [authDestResult, setAuthDestResult] = useState<boolean | null>(null);

  // Velocity query
  const [velocityUser, setVelocityUser] = useState(
    state.roles.cardholder.keypair?.publicKey() ?? "",
  );
  const [velocityResult, setVelocityResult] =
    useState<UserVelocityResult | null>(null);

  // Owner / Pauser
  const [ownerResult, setOwnerResult] = useState<string | null>(null);
  const [pauserResult, setPauserResult] = useState<string | null>(null);

  // Pause
  const [pausedResult, setPausedResult] = useState<boolean | null>(null);

  // Balances
  const [balanceAddr, setBalanceAddr] = useState(
    state.roles.cardholder.keypair?.publicKey() ?? "",
  );
  const [balanceResult, setBalanceResult] = useState<string | null>(null);

  const [queryError, setQueryError] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);

  const runQuery = useCallback(
    async (fn: () => Promise<void>) => {
      setIsQuerying(true);
      setQueryError("");
      try {
        await fn();
      } catch (e) {
        setQueryError(errorMessage(e));
      } finally {
        setIsQuerying(false);
      }
    },
    [],
  );

  return (
    <div>
      <Heading as="h1" size="md">
        Inspector
      </Heading>
      <Text as="p" size="sm">
        Query on-chain contract state (read-only). All queries use simulation
        only.
      </Text>

      {queryError && <div className="InlineError">{queryError}</div>}

      {/* Owner & Pauser */}
      <div className="PageSection">
        <div className="PageSection__title">Owner &amp; Pauser</div>
        <Card>
          <div className="FormStack">
            <div className="FormRow">
              <Button
                size="sm"
                variant="tertiary"
                isLoading={isQuerying}
                onClick={() =>
                  runQuery(async () => {
                    const [o, p] = await Promise.all([
                      getOwner({
                        factoryId: state.factoryContractId!,
                        callerPublicKey,
                      }),
                      getPauser({
                        factoryId: state.factoryContractId!,
                        callerPublicKey,
                      }),
                    ]);
                    setOwnerResult(o);
                    setPauserResult(p);
                  })
                }
              >
                Query
              </Button>
            </div>
            {ownerResult !== null && (
              <Text as="p" size="sm">
                Owner: <strong>{ownerResult}</strong>
              </Text>
            )}
            {pauserResult !== null && (
              <Text as="p" size="sm">
                Pauser: <strong>{pauserResult}</strong>
              </Text>
            )}
          </div>
        </Card>
      </div>

      {/* Pause Status */}
      <div className="PageSection">
        <div className="PageSection__title">Pause Status</div>
        <Card>
          <div className="FormRow">
            <Button
              size="sm"
              variant="tertiary"
              isLoading={isQuerying}
              onClick={() =>
                runQuery(async () => {
                  const result = await isPaused({
                    factoryId: state.factoryContractId!,
                    callerPublicKey,
                  });
                  setPausedResult(result);
                })
              }
            >
              Query
            </Button>
            {pausedResult !== null && (
              <Text as="p" size="sm">
                <strong>{pausedResult ? "PAUSED" : "Active"}</strong>
              </Text>
            )}
          </div>
        </Card>
      </div>

      {/* Issuer Address */}
      <div className="PageSection">
        <div className="PageSection__title">Get Issuer Address</div>
        <Card>
          <div className="FormStack">
            <Input
              id="insp-issuer-id"
              fieldSize="sm"
              label="Issuer ID (hex)"
              value={issuerQueryId}
              onChange={(e) => setIssuerQueryId(e.target.value)}
            />
            <Input
              id="insp-issuer-token"
              fieldSize="sm"
              label="Token Contract ID"
              value={issuerQueryToken}
              onChange={(e) => setIssuerQueryToken(e.target.value)}
            />
            <Button
              size="sm"
              variant="tertiary"
              isLoading={isQuerying}
              onClick={() =>
                runQuery(async () => {
                  const addr = await getIssuerAddress({
                    factoryId: state.factoryContractId!,
                    issuerId: hexToBytes(issuerQueryId),
                    token: issuerQueryToken,
                    callerPublicKey,
                  });
                  setIssuerAddressResult(addr);
                })
              }
            >
              Query
            </Button>
            {issuerAddressResult && (
              <div className="ResultValue">{issuerAddressResult}</div>
            )}
          </div>
        </Card>
      </div>

      {/* Authorization Checks */}
      <div className="PageSection">
        <div className="PageSection__title">Authorization Checks</div>
        <Card>
          <div className="FormStack">
            {/* Debitor */}
            <div className="FormRow">
              <Input
                id="insp-auth-debitor"
                fieldSize="sm"
                label="Debitor Address"
                value={authDebitorAddr}
                onChange={(e) => setAuthDebitorAddr(e.target.value)}
              />
              <Button
                size="sm"
                variant="tertiary"
                isLoading={isQuerying}
                onClick={() =>
                  runQuery(async () => {
                    const r = await isAuthorizedDebitor({
                      factoryId: state.factoryContractId!,
                      issuerId: hexToBytes(issuerQueryId),
                      debitor: authDebitorAddr,
                      callerPublicKey,
                    });
                    setAuthDebitorResult(r);
                  })
                }
              >
                Check
              </Button>
              {authDebitorResult !== null && (
                <Text as="p" size="xs">
                  {authDebitorResult ? "Authorized" : "Not Authorized"}
                </Text>
              )}
            </div>

            {/* Manager */}
            <div className="FormRow">
              <Input
                id="insp-auth-manager"
                fieldSize="sm"
                label="Manager Address"
                value={authManagerAddr}
                onChange={(e) => setAuthManagerAddr(e.target.value)}
              />
              <Button
                size="sm"
                variant="tertiary"
                isLoading={isQuerying}
                onClick={() =>
                  runQuery(async () => {
                    const r = await isAuthorizedManager({
                      factoryId: state.factoryContractId!,
                      issuerId: hexToBytes(issuerQueryId),
                      manager: authManagerAddr,
                      callerPublicKey,
                    });
                    setAuthManagerResult(r);
                  })
                }
              >
                Check
              </Button>
              {authManagerResult !== null && (
                <Text as="p" size="xs">
                  {authManagerResult ? "Authorized" : "Not Authorized"}
                </Text>
              )}
            </div>

            {/* Destination */}
            <div className="FormRow">
              <Input
                id="insp-auth-dest"
                fieldSize="sm"
                label="Destination Address"
                value={authDestAddr}
                onChange={(e) => setAuthDestAddr(e.target.value)}
              />
              <Button
                size="sm"
                variant="tertiary"
                isLoading={isQuerying}
                onClick={() =>
                  runQuery(async () => {
                    const r = await isAuthorizedDestination({
                      factoryId: state.factoryContractId!,
                      issuerId: hexToBytes(issuerQueryId),
                      destination: authDestAddr,
                      callerPublicKey,
                    });
                    setAuthDestResult(r);
                  })
                }
              >
                Check
              </Button>
              {authDestResult !== null && (
                <Text as="p" size="xs">
                  {authDestResult ? "Authorized" : "Not Authorized"}
                </Text>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* User Velocity */}
      <div className="PageSection">
        <div className="PageSection__title">User Velocity</div>
        <Card>
          <div className="FormStack">
            <Input
              id="insp-velocity-user"
              fieldSize="sm"
              label="User Address"
              value={velocityUser}
              onChange={(e) => setVelocityUser(e.target.value)}
            />
            <Button
              size="sm"
              variant="tertiary"
              isLoading={isQuerying}
              onClick={() =>
                runQuery(async () => {
                  const v = await getUserVelocity({
                    factoryId: state.factoryContractId!,
                    issuerId: hexToBytes(issuerQueryId),
                    token: issuerQueryToken,
                    user: velocityUser,
                    callerPublicKey,
                  });
                  setVelocityResult(v);
                })
              }
            >
              Query
            </Button>
            {velocityResult && (
              <pre className="ResultValue">
                {JSON.stringify(
                  {
                    period_duration_seconds:
                      velocityResult.period_duration_seconds.toString(),
                    period_spend_limit:
                      formatAmount(velocityResult.period_spend_limit.toString(), units),
                    per_transaction_spend_limit:
                      formatAmount(velocityResult.per_transaction_spend_limit.toString(), units),
                    period_spent:
                      formatAmount(velocityResult.period_spent.toString(), units),
                    period_last_reset_timestamp:
                      velocityResult.period_last_reset_timestamp.toString(),
                    ledger_last_spent: velocityResult.ledger_last_spent,
                    has_spent: velocityResult.has_spent,
                    units: unitSuffix(units),
                  },
                  null,
                  2,
                )}
              </pre>
            )}
          </div>
        </Card>
      </div>

      {/* Token Balance */}
      <div className="PageSection">
        <div className="PageSection__title">Token Balance</div>
        <Card>
          <div className="FormStack">
            <Input
              id="insp-balance-addr"
              fieldSize="sm"
              label="Address"
              value={balanceAddr}
              onChange={(e) => setBalanceAddr(e.target.value)}
            />
            <Button
              size="sm"
              variant="tertiary"
              isLoading={isQuerying}
              onClick={() =>
                runQuery(async () => {
                  const b = await getBalance({
                    tokenId: state.tokenContractId ?? issuerQueryToken,
                    address: balanceAddr,
                    callerPublicKey,
                  });
                  setBalanceResult(b.toString());
                })
              }
            >
              Query
            </Button>
            {balanceResult !== null && (
              <Text as="p" size="sm">
                <strong>{formatAmount(balanceResult!, units)}</strong> {unitSuffix(units)}
              </Text>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
