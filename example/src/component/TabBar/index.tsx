import { useAppState, useAppDispatch } from "@/store.ts";
import type { TabName } from "@/types.ts";

import "./styles.scss";

const TABS: { id: TabName; label: string }[] = [
  { id: "setup", label: "Setup" },
  { id: "guide", label: "Guide" },
  { id: "owner", label: "Owner" },
  { id: "manager", label: "Manager" },
  { id: "cardholder", label: "Cardholder" },
  { id: "debitor", label: "Debitor" },
  { id: "pauser", label: "Pauser" },
  { id: "inspector", label: "Inspector" },
];

export const TabBar = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const isTabEnabled = (tab: TabName): boolean => {
    switch (tab) {
      case "setup":
      case "guide":
        return true;
      case "owner":
        return !!(state.factoryContractId && state.roles.owner.keypair);
      case "manager":
        return !!(
          state.factoryContractId &&
          state.issuerContractId &&
          state.roles.manager.keypair
        );
      case "cardholder":
        return !!(state.issuerContractId && state.roles.cardholder.keypair);
      case "debitor":
        return !!(state.issuerContractId && state.roles.debitor.keypair);
      case "pauser":
        return !!(state.factoryContractId && state.roles.pauser.keypair);
      case "inspector":
        return !!state.factoryContractId;
      default:
        return false;
    }
  };

  return (
    <nav className="TabBar">
      {TABS.map((tab) => {
        const enabled = isTabEnabled(tab.id);
        return (
          <button
            key={tab.id}
            className="TabBar__tab"
            data-active={state.activeTab === tab.id}
            disabled={!enabled}
            onClick={() => dispatch({ type: "SET_TAB", tab: tab.id })}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};
