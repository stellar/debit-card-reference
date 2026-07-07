import { useEffect } from "react";

import { useAppState, useAppDispatch } from "@/store.ts";
import { unitSuffix } from "@/helper/units.ts";
import { isPaused } from "@/soroban/factory.ts";

const truncateAddress = (addr: string | null) => {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
};

export const StatusBar = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();

  // Any funded keypair works as the simulation source for the read-only
  // `paused()` query.
  const callerPublicKey =
    state.roles.owner.keypair?.publicKey() ??
    state.roles.pauser.keypair?.publicKey() ??
    null;

  // Refresh the pause badge on tab change; pause/unpause handlers dispatch
  // SET_PAUSED directly so the badge also updates without a refetch.
  useEffect(() => {
    if (!state.factoryContractId || !callerPublicKey) return;
    let cancelled = false;
    isPaused({ factoryId: state.factoryContractId, callerPublicKey })
      .then((paused) => {
        if (!cancelled) dispatch({ type: "SET_PAUSED", paused });
      })
      .catch(() => {
        // ignore query errors (e.g. unfunded account during setup)
      });
    return () => {
      cancelled = true;
    };
  }, [state.factoryContractId, state.activeTab, callerPublicKey, dispatch]);

  return (
    <div className="StatusBar">
      <div className="StatusBar__item">
        <span className="StatusBar__label">Factory</span>
        <span
          className="StatusBar__value"
          data-connected={!!state.factoryContractId}
        >
          {truncateAddress(state.factoryContractId)}
        </span>
      </div>
      <div className="StatusBar__item">
        <span className="StatusBar__label">Issuer</span>
        <span
          className="StatusBar__value"
          data-connected={!!state.issuerContractId}
        >
          {truncateAddress(state.issuerContractId)}
        </span>
      </div>
      <div className="StatusBar__item">
        <span className="StatusBar__label">Token</span>
        <span
          className="StatusBar__value"
          data-connected={!!state.tokenContractId}
        >
          {truncateAddress(state.tokenContractId)}
        </span>
      </div>
      <div className="StatusBar__item">
        <span className="StatusBar__label">Status</span>
        <span
          className="StatusBar__pause"
          data-paused={state.paused === null ? "unknown" : String(state.paused)}
        >
          {state.paused === null ? "—" : state.paused ? "PAUSED" : "Active"}
        </span>
      </div>
      <button
        className="StatusBar__unitToggle"
        onClick={() =>
          dispatch({
            type: "SET_DISPLAY_UNITS",
            units: state.displayUnits === "stroops" ? "xlm" : "stroops",
          })
        }
      >
        {unitSuffix(state.displayUnits)}
      </button>
    </div>
  );
};
