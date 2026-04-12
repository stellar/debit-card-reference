import type { Keypair } from "@stellar/stellar-sdk";
import type { DisplayUnits } from "@/helper/units.ts";

export type RoleName =
  | "owner"
  | "pauser"
  | "manager"
  | "debitor"
  | "cardholder"
  | "destination";

export type TabName =
  | "setup"
  | "guide"
  | "owner"
  | "manager"
  | "cardholder"
  | "debitor"
  | "pauser"
  | "inspector";

export interface RoleState {
  keypair: Keypair | null;
  funded: boolean;
}

export interface LogEntry {
  id: number;
  timestamp: Date;
  method: string;
  request: unknown;
  response: unknown;
  rawResponse?: unknown;
  durationMs: number;
  status: "success" | "error";
}

export interface AppState {
  roles: Record<RoleName, RoleState>;
  tokenContractId: string | null;
  factoryContractId: string | null;
  issuerContractId: string | null;
  issuerId: string | null;
  destinationAddress: string | null;
  logs: LogEntry[];
  activeTab: TabName;
  displayUnits: DisplayUnits;
}

export type AppAction =
  | { type: "SET_KEYPAIR"; role: RoleName; keypair: Keypair }
  | { type: "SET_FUNDED"; role: RoleName }
  | { type: "SET_TOKEN"; tokenContractId: string }
  | { type: "SET_FACTORY"; factoryContractId: string }
  | {
      type: "SET_ISSUER";
      issuerContractId: string;
      issuerId: string;
    }
  | { type: "SET_DESTINATION"; destinationAddress: string }
  | { type: "ADD_LOG"; entry: Omit<LogEntry, "id"> }
  | { type: "CLEAR_LOGS" }
  | { type: "SET_TAB"; tab: TabName }
  | { type: "SET_DISPLAY_UNITS"; units: DisplayUnits }
  | { type: "LOAD_SESSION"; session: Partial<AppState> }
  | { type: "RESET_STATE" };
