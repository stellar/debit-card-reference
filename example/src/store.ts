import { createContext, useContext } from "react";
import type { AppState, AppAction, RoleName } from "@/types.ts";

const defaultRole = () => ({ keypair: null, funded: false });

export const initialState: AppState = {
  roles: {
    owner: defaultRole(),
    pauser: defaultRole(),
    manager: defaultRole(),
    debitor: defaultRole(),
    cardholder: defaultRole(),
    destination: defaultRole(),
  },
  tokenContractId: null,
  factoryContractId: null,
  issuerContractId: null,
  issuerId: null,
  destinationAddress: null,
  logs: [],
  activeTab: "setup",
  displayUnits: "stroops",
};

let logCounter = 0;

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_KEYPAIR":
      return {
        ...state,
        roles: {
          ...state.roles,
          [action.role]: { ...state.roles[action.role], keypair: action.keypair },
        },
      };
    case "SET_FUNDED":
      return {
        ...state,
        roles: {
          ...state.roles,
          [action.role]: { ...state.roles[action.role as RoleName], funded: true },
        },
      };
    case "SET_TOKEN":
      return { ...state, tokenContractId: action.tokenContractId };
    case "SET_FACTORY":
      return { ...state, factoryContractId: action.factoryContractId };
    case "SET_ISSUER":
      return {
        ...state,
        issuerContractId: action.issuerContractId,
        issuerId: action.issuerId,
      };
    case "SET_DESTINATION":
      return { ...state, destinationAddress: action.destinationAddress };
    case "ADD_LOG":
      return {
        ...state,
        logs: [...state.logs, { ...action.entry, id: ++logCounter }],
      };
    case "CLEAR_LOGS":
      return { ...state, logs: [] };
    case "SET_TAB":
      return { ...state, activeTab: action.tab };
    case "SET_DISPLAY_UNITS":
      return { ...state, displayUnits: action.units };
    case "LOAD_SESSION":
      return {
        ...initialState,
        ...action.session,
        logs: state.logs,
        activeTab: "setup",
      };
    case "RESET_STATE":
      return { ...initialState, logs: state.logs };
    default:
      return state;
  }
}

export const AppStateContext = createContext<AppState>(initialState);
export const AppDispatchContext = createContext<React.Dispatch<AppAction>>(
  () => {},
);

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}
