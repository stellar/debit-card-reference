import { useAppState, useAppDispatch } from "@/store.ts";
import { unitSuffix } from "@/helper/units.ts";

const truncateAddress = (addr: string | null) => {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
};

export const StatusBar = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();

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
