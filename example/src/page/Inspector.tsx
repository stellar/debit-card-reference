import { useState, useCallback } from "react";
import {
  Button,
  Card,
  Heading,
  Input,
  Select,
  Text,
} from "@stellar/design-system";
import { xdr, Address } from "@stellar/stellar-sdk";

import { useAppState } from "@/store.ts";
import { errorMessage } from "@/helper/errors.ts";
import { formatAmount, unitSuffix } from "@/helper/units.ts";
import {
  hexToBytes,
  toScValAddress,
  toScValBytes32,
} from "@/soroban/codec.ts";
import { getSorobanServer } from "@/soroban/client.ts";
import { decodeRpcEvent, type EventInfo } from "@/helper/xdr.ts";
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

// ─── Events (FIND-010): getEvents topic-filter presets ──────────────────────
// `#[contractevent]` publishes topic0 = event name (struct name in snake_case)
// followed by each `#[topic]` field in declaration order. Non-topic fields
// live in event data and cannot be filtered server-side.
interface EventPreset {
  id: string;
  label: string;
  /** topic0 symbol; empty = no topic filter (all factory events). */
  symbol: string;
  /** Total number of topics, including topic0. */
  topicCount: number;
  /** Index of the filterable topic; null = no value filter. */
  filterPosition: number | null;
  filterKind: "address" | "bytes32" | null;
  filterLabel: string;
}

const EVENT_PRESETS: EventPreset[] = [
  {
    id: "all",
    label: "All factory events",
    symbol: "",
    topicCount: 0,
    filterPosition: null,
    filterKind: null,
    filterLabel: "",
  },
  {
    id: "transfer_by_uuid",
    label: "transfer_executed — by uuid",
    symbol: "transfer_executed",
    topicCount: 4,
    filterPosition: 1,
    filterKind: "bytes32",
    filterLabel: "uuid (64-char hex)",
  },
  {
    id: "transfer_by_account",
    label: "transfer_executed — by account",
    symbol: "transfer_executed",
    topicCount: 4,
    filterPosition: 3,
    filterKind: "address",
    filterLabel: "account address",
  },
  {
    id: "debitor_updated",
    label: "debitor_updated — by debitor",
    symbol: "debitor_updated",
    topicCount: 3,
    filterPosition: 2,
    filterKind: "address",
    filterLabel: "debitor address",
  },
  {
    id: "managed_updated",
    label: "managed_updated — by issuer_id",
    symbol: "managed_updated",
    topicCount: 3,
    filterPosition: 1,
    filterKind: "bytes32",
    filterLabel: "issuer_id (64-char hex)",
  },
  {
    id: "destination_updated",
    label: "destination_updated — by issuer_id",
    symbol: "destination_updated",
    topicCount: 3,
    filterPosition: 1,
    filterKind: "bytes32",
    filterLabel: "issuer_id (64-char hex)",
  },
  {
    id: "issuer_created",
    label: "issuer_created — by issuer_id",
    symbol: "issuer_created",
    topicCount: 3,
    filterPosition: 1,
    filterKind: "bytes32",
    filterLabel: "issuer_id (64-char hex)",
  },
  {
    id: "paused",
    label: "paused",
    symbol: "paused",
    topicCount: 2,
    filterPosition: null,
    filterKind: null,
    filterLabel: "",
  },
  {
    id: "unpaused",
    label: "unpaused",
    symbol: "unpaused",
    topicCount: 2,
    filterPosition: null,
    filterKind: null,
    filterLabel: "",
  },
];

interface EventRow extends EventInfo {
  ledger: number;
  txHash: string;
}

// ~24h of ledgers at 5s each; capped below by the RPC retention window.
const EVENTS_LOOKBACK_LEDGERS = 17_280;

// ─── Storage TTL (FIND-002) ──────────────────────────────────────────────────
// Fallback when the state-archival config entry can't be read: 3,110,400
// ledgers ≈ 180 days at 5s/ledger (the current network maximum entry TTL).
const FALLBACK_MAX_ENTRY_TTL = 3_110_400;

interface TtlRow {
  label: string;
  found: boolean;
  liveUntil?: number;
  remaining?: number;
  days?: string;
  atMax?: boolean;
}

function contractInstanceKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

// Persistent policy entry key. `#[contracttype] enum PersistentKey` tuple
// variants encode as `scvVec [scvSymbol(variant), ...fields]` — must match
// contracts/factory/src/storage.rs.
function persistentPolicyKey(
  factoryId: string,
  variant: string,
  fields: xdr.ScVal[],
): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(factoryId).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(variant), ...fields]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

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

  // Events (FIND-010)
  const [eventPresetId, setEventPresetId] = useState("all");
  const [eventFilterValue, setEventFilterValue] = useState("");
  const [eventRows, setEventRows] = useState<EventRow[] | null>(null);
  const eventPreset =
    EVENT_PRESETS.find((p) => p.id === eventPresetId) ?? EVENT_PRESETS[0];

  const prefillForPreset = useCallback(
    (preset: EventPreset): string => {
      switch (preset.id) {
        case "transfer_by_account":
          return state.roles.cardholder.keypair?.publicKey() ?? "";
        case "debitor_updated":
          return state.roles.debitor.keypair?.publicKey() ?? "";
        case "managed_updated":
        case "destination_updated":
        case "issuer_created":
          return state.issuerId ?? "";
        default:
          return "";
      }
    },
    [state.roles.cardholder.keypair, state.roles.debitor.keypair, state.issuerId],
  );

  const handleQueryEvents = useCallback(async () => {
    if (!state.factoryContractId) return;
    setEventRows(null);
    const factoryId = state.factoryContractId;
    const preset = eventPreset;
    const filterValue = eventFilterValue.trim();

    let topics: string[] | null = null;
    if (preset.topicCount > 0) {
      topics = Array<string>(preset.topicCount).fill("*");
      topics[0] = xdr.ScVal.scvSymbol(preset.symbol).toXDR("base64");
      if (preset.filterPosition !== null && filterValue) {
        if (preset.filterKind === "bytes32" && !/^[0-9a-fA-F]{64}$/.test(filterValue)) {
          throw new Error(`${preset.filterLabel} must be 64 hex characters`);
        }
        topics[preset.filterPosition] =
          preset.filterKind === "address"
            ? toScValAddress(filterValue).toXDR("base64")
            : toScValBytes32(hexToBytes(filterValue)).toXDR("base64");
      }
    }

    const server = getSorobanServer();
    // GetHealthResponse's type only declares `status`, but the RPC also
    // returns the retention window; use it to clamp the 24h lookback.
    const health = (await server.getHealth()) as unknown as {
      status: string;
      latestLedger?: number;
      oldestLedger?: number;
    };
    const latest =
      health.latestLedger ?? (await server.getLatestLedger()).sequence;
    const startLedger = Math.max(
      health.oldestLedger ?? 1,
      latest - EVENTS_LOOKBACK_LEDGERS,
    );

    const filters = [
      {
        type: "contract" as const,
        contractIds: [factoryId],
        ...(topics ? { topics: [topics] } : {}),
      },
    ];

    // The RPC scans a bounded ledger window per page (returning an empty
    // page + cursor when nothing matched yet), so follow the cursor until
    // the scan reaches the latest ledger or we have a full page of events.
    const collected: EventRow[] = [];
    let response = await server.getEvents({
      startLedger,
      endLedger: latest,
      filters,
      limit: 50,
    });
    for (let page = 0; page < 10; page++) {
      collected.push(
        ...response.events.map((e) => ({
          ledger: e.ledger,
          txHash: e.txHash,
          ...decodeRpcEvent(e.topic, e.value),
        })),
      );
      if (collected.length >= 50 || !response.cursor) break;
      // Cursor prefix is a TOID; its high 32 bits are the ledger the scan
      // stopped at.
      const cursorLedger = Number(
        BigInt(response.cursor.split("-")[0]) >> 32n,
      );
      if (cursorLedger >= latest) break;
      response = await server.getEvents({
        cursor: response.cursor,
        filters,
        limit: 50,
      });
    }

    setEventRows(collected);
  }, [state.factoryContractId, eventPreset, eventFilterValue]);

  // Storage TTL (FIND-002)
  const [ttlRows, setTtlRows] = useState<TtlRow[] | null>(null);
  const [ttlMeta, setTtlMeta] = useState<{
    latest: number;
    maxTtl: number;
  } | null>(null);

  const handleQueryTtls = useCallback(async () => {
    if (!state.factoryContractId) return;
    setTtlRows(null);
    setTtlMeta(null);
    const factoryId = state.factoryContractId;
    const issuerIdBytes = state.issuerId ? hexToBytes(state.issuerId) : null;
    const debitorPub = state.roles.debitor.keypair?.publicKey() ?? null;
    const cardholderPub = state.roles.cardholder.keypair?.publicKey() ?? null;
    const destination =
      state.destinationAddress ??
      state.roles.destination.keypair?.publicKey() ??
      null;

    const labeledKeys: { label: string; key: xdr.LedgerKey }[] = [
      { label: "Factory instance", key: contractInstanceKey(factoryId) },
    ];
    if (state.issuerContractId) {
      labeledKeys.push({
        label: "Issuer instance",
        key: contractInstanceKey(state.issuerContractId),
      });
    }
    if (issuerIdBytes) {
      const issuerIdVal = toScValBytes32(issuerIdBytes);
      if (destination) {
        labeledKeys.push({
          label: "AllowedDestination",
          key: persistentPolicyKey(factoryId, "AllowedDestination", [
            issuerIdVal,
            toScValAddress(destination),
          ]),
        });
      }
      labeledKeys.push({
        label: "IssuerManager",
        key: persistentPolicyKey(factoryId, "IssuerManager", [issuerIdVal]),
      });
      if (state.tokenContractId) {
        labeledKeys.push({
          label: "IssuerAddress",
          key: persistentPolicyKey(factoryId, "IssuerAddress", [
            issuerIdVal,
            toScValAddress(state.tokenContractId),
          ]),
        });
      }
      if (debitorPub) {
        labeledKeys.push({
          label: "AuthorizedDebitor",
          key: persistentPolicyKey(factoryId, "AuthorizedDebitor", [
            issuerIdVal,
            toScValAddress(debitorPub),
          ]),
        });
      }
      if (state.tokenContractId && cardholderPub) {
        labeledKeys.push({
          label: "UserVelocity",
          key: persistentPolicyKey(factoryId, "UserVelocity", [
            issuerIdVal,
            toScValAddress(state.tokenContractId),
            toScValAddress(cardholderPub),
          ]),
        });
      }
    }

    // Fetch the live network max entry TTL alongside, so "at max" is exact.
    const archivalConfigKey = xdr.LedgerKey.configSetting(
      new xdr.LedgerKeyConfigSetting({
        configSettingId: xdr.ConfigSettingId.configSettingStateArchival(),
      }),
    );

    const server = getSorobanServer();
    const response = await server.getLedgerEntries(
      ...labeledKeys.map((k) => k.key),
      archivalConfigKey,
    );

    let maxTtl = FALLBACK_MAX_ENTRY_TTL;
    try {
      const cfg = response.entries.find(
        (e) => e.key.switch().name === "configSetting",
      );
      if (cfg) {
        maxTtl = cfg.val.configSetting().stateArchivalSettings().maxEntryTtl();
      }
    } catch {
      // keep fallback
    }

    const byKey = new Map(
      response.entries.map((e) => [e.key.toXDR("base64"), e]),
    );
    const latest = response.latestLedger;
    setTtlRows(
      labeledKeys.map(({ label, key }) => {
        const entry = byKey.get(key.toXDR("base64"));
        if (!entry || entry.liveUntilLedgerSeq == null) {
          return { label, found: false };
        }
        const liveUntil = entry.liveUntilLedgerSeq;
        const remaining = liveUntil - latest;
        return {
          label,
          found: true,
          liveUntil,
          remaining,
          days: ((remaining * 5) / 86400).toFixed(1),
          atMax: remaining >= 0.99 * maxTtl,
        };
      }),
    );
    setTtlMeta({ latest, maxTtl });
  }, [
    state.factoryContractId,
    state.issuerContractId,
    state.issuerId,
    state.tokenContractId,
    state.destinationAddress,
    state.roles.debitor.keypair,
    state.roles.cardholder.keypair,
    state.roles.destination.keypair,
  ]);

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
            {velocityResult && (
              <Text as="p" size="xs">
                {velocityResult.period_last_reset_timestamp === 0n ? (
                  <>
                    Fixed window not yet anchored — the first transfer at or
                    after <code>period_last_reset_timestamp +
                    period_duration_seconds</code> re-anchors the window and
                    resets <code>period_spent</code>.
                  </>
                ) : (
                  <>
                    Window resets at <code>period_last_reset_timestamp +
                    period_duration_seconds</code> ={" "}
                    <strong>
                      {new Date(
                        Number(
                          velocityResult.period_last_reset_timestamp +
                            velocityResult.period_duration_seconds,
                        ) * 1000,
                      ).toISOString()}
                    </strong>{" "}
                    (the first transfer at or after that instant re-anchors the
                    window and resets <code>period_spent</code>)
                  </>
                )}
              </Text>
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

      {/* Events (FIND-010) */}
      <div className="PageSection">
        <div className="PageSection__title">Events</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Server-side event queries via RPC <code>getEvents</code>, using
              the <code>#[topic]</code> fields added in FIND-010. Looks back
              ~24h (capped by RPC retention). Note: on{" "}
              <code>transfer_executed</code>, <code>debitor</code> is event{" "}
              <strong>data</strong>, not a topic — it cannot be filtered
              server-side; filter by <code>uuid</code> or <code>account</code>{" "}
              instead.
            </Text>
            <Select
              id="insp-event-preset"
              fieldSize="sm"
              label="Event"
              value={eventPresetId}
              onChange={(e) => {
                const preset =
                  EVENT_PRESETS.find((p) => p.id === e.target.value) ??
                  EVENT_PRESETS[0];
                setEventPresetId(preset.id);
                setEventFilterValue(prefillForPreset(preset));
                setEventRows(null);
              }}
            >
              {EVENT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            {eventPreset.filterPosition !== null && (
              <Input
                id="insp-event-filter"
                fieldSize="sm"
                label={eventPreset.filterLabel}
                value={eventFilterValue}
                onChange={(e) => setEventFilterValue(e.target.value)}
                note="leave empty to match any value (wildcard)"
              />
            )}
            <Button
              size="sm"
              variant="tertiary"
              isLoading={isQuerying}
              disabled={!state.factoryContractId}
              onClick={() => runQuery(handleQueryEvents)}
            >
              Query Events
            </Button>
            {eventRows && eventRows.length === 0 && (
              <Text as="p" size="xs">
                No matching events in the queried range.
              </Text>
            )}
            {eventRows && eventRows.length > 0 && (
              <div className="FormStack">
                {eventRows.map((e, i) => (
                  <pre key={i} className="ResultValue">
                    {`ledger ${e.ledger}  tx ${e.txHash.slice(0, 8)}…\n${e.name ?? "event"}\n  topics: [${e.topics.join(", ")}]\n  data:   ${e.data}`}
                  </pre>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Storage TTL (FIND-002) */}
      <div className="PageSection">
        <div className="PageSection__title">Storage TTL</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Live-until ledgers for the contract instances and the five
              persistent policy entries. With the FIND-002 fix, every entry
              touched by setup sits at ≈ <code>latest + max TTL</code>; without
              it, fresh entries sit at the network minimum. The ~30-day
              re-extension threshold cannot be reached within a manual session,
              so this panel verifies extension-to-max on creation/access — the
              decay-triggered re-extension path is covered by the contract test
              suite.
            </Text>
            <Button
              size="sm"
              variant="tertiary"
              isLoading={isQuerying}
              disabled={!state.factoryContractId}
              onClick={() => runQuery(handleQueryTtls)}
            >
              Query TTLs
            </Button>
            {ttlMeta && (
              <Text as="p" size="xs">
                Latest ledger: <strong>{ttlMeta.latest}</strong> — network max
                entry TTL: <strong>{ttlMeta.maxTtl}</strong> ledgers (~
                {((ttlMeta.maxTtl * 5) / 86400).toFixed(0)} days)
              </Text>
            )}
            {ttlRows &&
              ttlRows.map((row) => (
                <Text as="p" size="xs" key={row.label}>
                  <strong>{row.label}</strong>:{" "}
                  {row.found ? (
                    <>
                      live until ledger {row.liveUntil} — {row.remaining}{" "}
                      ledgers (~{row.days} days) remaining
                      {row.atMax ? (
                        <span className="InlineSuccess"> ✓ at network max</span>
                      ) : (
                        <span className="InlineError"> below network max</span>
                      )}
                    </>
                  ) : (
                    "not found (never created, removed, or archived)"
                  )}
                </Text>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
