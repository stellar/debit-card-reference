import { useReducer, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Header } from "@/component/Header.tsx";
import { SessionPicker } from "@/component/SessionPicker.tsx";
import { StatusBar } from "@/component/StatusBar.tsx";
import { TabBar } from "@/component/TabBar/index.tsx";
import { LogPane } from "@/component/LogPane/index.tsx";
import { Setup } from "@/page/Setup.tsx";
import { Guide } from "@/page/Guide.tsx";
import { Owner } from "@/page/Owner.tsx";
import { Manager } from "@/page/Manager.tsx";
import { Cardholder } from "@/page/Cardholder.tsx";
import { Debitor } from "@/page/Debitor.tsx";
import { Pauser } from "@/page/Pauser.tsx";
import { Inspector } from "@/page/Inspector.tsx";
import {
  AppStateContext,
  AppDispatchContext,
  appReducer,
  initialState,
} from "@/store.ts";
import { setLogDispatch } from "@/soroban/client.ts";
import { saveSession } from "@/helper/sessionStorage.ts";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function TabContent({ tab }: { tab: string }) {
  switch (tab) {
    case "setup":
      return <Setup />;
    case "guide":
      return <Guide />;
    case "owner":
      return <Owner />;
    case "manager":
      return <Manager />;
    case "cardholder":
      return <Cardholder />;
    case "debitor":
      return <Debitor />;
    case "pauser":
      return <Pauser />;
    case "inspector":
      return <Inspector />;
    default:
      return null;
  }
}

function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useEffect(() => {
    setLogDispatch(dispatch);
  }, [dispatch]);

  // Auto-save to localStorage (debounced, only when factoryContractId is set)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevSnapshotRef = useRef("");
  useEffect(() => {
    if (!state.factoryContractId) return;
    const snapshot = JSON.stringify({
      roles: state.roles,
      tokenContractId: state.tokenContractId,
      factoryContractId: state.factoryContractId,
      issuerContractId: state.issuerContractId,
      issuerId: state.issuerId,
      destinationAddress: state.destinationAddress,
      displayUnits: state.displayUnits,
    });
    if (snapshot === prevSnapshotRef.current) return;
    prevSnapshotRef.current = snapshot;

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveSession(state), 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [state]);

  return (
    <QueryClientProvider client={queryClient}>
      <AppStateContext value={state}>
        <AppDispatchContext value={dispatch}>
          <div className="StellarApp">
            <Header />
            <SessionPicker />
            <StatusBar />
            <div className="StellarApp__main">
              <div className="StellarApp__left">
                <TabBar />
                <div className="StellarApp__tabContent">
                  <TabContent key={state.activeTab} tab={state.activeTab} />
                </div>
              </div>
              <div className="StellarApp__right">
                <LogPane />
              </div>
            </div>
          </div>
        </AppDispatchContext>
      </AppStateContext>
    </QueryClientProvider>
  );
}

export default App;
