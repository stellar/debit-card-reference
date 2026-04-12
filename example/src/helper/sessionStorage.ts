import { Keypair } from "@stellar/stellar-sdk";
import type { AppState, RoleName } from "@/types.ts";
import type { DisplayUnits } from "@/helper/units.ts";

const ROLE_NAMES: RoleName[] = [
  "owner",
  "pauser",
  "manager",
  "debitor",
  "cardholder",
  "destination",
];

const INDEX_KEY = "debitcard:sessions";
const SESSION_PREFIX = "debitcard:session:";

interface SerializedRoleState {
  secretKey: string | null;
  funded: boolean;
}

interface SerializedSession {
  roles: Record<RoleName, SerializedRoleState>;
  tokenContractId: string | null;
  factoryContractId: string;
  issuerContractId: string | null;
  issuerId: string | null;
  destinationAddress: string | null;
  displayUnits: DisplayUnits;
}

export interface SessionIndexEntry {
  factoryContractId: string;
  label: string;
  updatedAt: string;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function serializeState(state: AppState): SerializedSession | null {
  if (!state.factoryContractId) return null;

  const roles = {} as Record<RoleName, SerializedRoleState>;
  for (const name of ROLE_NAMES) {
    const role = state.roles[name];
    roles[name] = {
      secretKey: role.keypair ? role.keypair.secret() : null,
      funded: role.funded,
    };
  }

  return {
    roles,
    tokenContractId: state.tokenContractId,
    factoryContractId: state.factoryContractId,
    issuerContractId: state.issuerContractId,
    issuerId: state.issuerId,
    destinationAddress: state.destinationAddress,
    displayUnits: state.displayUnits,
  };
}

function deserializeSession(raw: SerializedSession): Partial<AppState> {
  const roles = {} as Record<RoleName, { keypair: Keypair | null; funded: boolean }>;
  for (const name of ROLE_NAMES) {
    const stored = raw.roles[name];
    let keypair: Keypair | null = null;
    if (stored?.secretKey) {
      try {
        keypair = Keypair.fromSecret(stored.secretKey);
      } catch {
        // Corrupt key — skip this role
      }
    }
    roles[name] = { keypair, funded: stored?.funded ?? false };
  }

  return {
    roles,
    tokenContractId: raw.tokenContractId,
    factoryContractId: raw.factoryContractId,
    issuerContractId: raw.issuerContractId,
    issuerId: raw.issuerId,
    destinationAddress: raw.destinationAddress,
    displayUnits: raw.displayUnits ?? "stroops",
  };
}

export function loadSessionIndex(): SessionIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionIndexEntry[];
  } catch {
    return [];
  }
}

function saveSessionIndex(index: SessionIndexEntry[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function saveSession(state: AppState): void {
  const serialized = serializeState(state);
  if (!serialized) return;

  const key = SESSION_PREFIX + serialized.factoryContractId;
  localStorage.setItem(key, JSON.stringify(serialized));

  // Upsert the index entry
  const index = loadSessionIndex();
  const existing = index.findIndex(
    (e) => e.factoryContractId === serialized.factoryContractId,
  );
  const entry: SessionIndexEntry = {
    factoryContractId: serialized.factoryContractId,
    label: truncateAddress(serialized.factoryContractId),
    updatedAt: new Date().toISOString(),
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  saveSessionIndex(index);
}

export function loadSession(factoryContractId: string): Partial<AppState> | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + factoryContractId);
    if (!raw) return null;
    return deserializeSession(JSON.parse(raw) as SerializedSession);
  } catch {
    return null;
  }
}

export function deleteSession(factoryContractId: string): void {
  localStorage.removeItem(SESSION_PREFIX + factoryContractId);
  const index = loadSessionIndex().filter(
    (e) => e.factoryContractId !== factoryContractId,
  );
  saveSessionIndex(index);
}
