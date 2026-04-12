import { rpc } from "@stellar/stellar-sdk";
import type { AppAction, LogEntry } from "@/types.ts";

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

let dispatch: React.Dispatch<AppAction> | null = null;

export function setLogDispatch(d: React.Dispatch<AppAction>) {
  dispatch = d;
}

export function addLog(entry: Omit<LogEntry, "id">) {
  dispatch?.({ type: "ADD_LOG", entry });
}

const XDR_RICH_METHODS = new Set([
  "simulateTransaction",
  "sendTransaction",
  "getTransaction",
]);

// Methods on rpc.Server that we want to log
const LOGGED_METHODS = new Set([
  "getAccount",
  "getHealth",
  "getLatestLedger",
  "getLedgerEntries",
  "getNetwork",
  "getTransaction",
  "getTransactions",
  "sendTransaction",
  "simulateTransaction",
  "prepareTransaction",
]);

export function getSorobanServer(): rpc.Server {
  const server = new rpc.Server(RPC_URL);

  return new Proxy(server, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof value !== "function" || typeof prop !== "string") {
        return value;
      }

      if (!LOGGED_METHODS.has(prop)) {
        return value.bind(target);
      }

      return async (...args: unknown[]) => {
        const startTime = performance.now();
        const methodName = prop;

        // Summarize args for the log (avoid logging full XDR blobs)
        let requestSummary: unknown;
        try {
          if (methodName === "getAccount") {
            requestSummary = { accountId: args[0] };
          } else if (methodName === "getTransaction") {
            requestSummary = { hash: args[0] };
          } else if (
            methodName === "simulateTransaction" ||
            methodName === "sendTransaction" ||
            methodName === "prepareTransaction"
          ) {
            const tx = args[0] as { toXDR?: () => string };
            requestSummary = {
              txHash: tx.toXDR ? `${tx.toXDR().slice(0, 40)}...` : "(tx)",
            };
          } else {
            requestSummary = args.length > 0 ? args : undefined;
          }
        } catch {
          requestSummary = { args: `(${args.length} args)` };
        }

        try {
          const result = await value.apply(target, args);

          // Summarize response for the log
          let responseSummary: unknown;
          try {
            if (methodName === "getAccount") {
              const acct = result as { accountId: () => string };
              responseSummary = { accountId: acct.accountId() };
            } else if (methodName === "getTransaction") {
              const txResult = result as { status: string };
              responseSummary = { status: txResult.status };
            } else if (methodName === "sendTransaction") {
              const sendResult = result as {
                status: string;
                hash: string;
              };
              responseSummary = {
                status: sendResult.status,
                hash: sendResult.hash,
              };
            } else if (methodName === "simulateTransaction") {
              if (rpc.Api.isSimulationError(result as rpc.Api.SimulateTransactionResponse)) {
                responseSummary = {
                  status: "error",
                  error: (result as rpc.Api.SimulateTransactionErrorResponse).error,
                };
              } else {
                responseSummary = { status: "success" };
              }
            } else if (methodName === "getLatestLedger") {
              responseSummary = result;
            } else {
              responseSummary = { type: typeof result };
            }
          } catch {
            responseSummary = { type: "ok" };
          }

          addLog({
            timestamp: new Date(),
            method: methodName,
            request: requestSummary,
            response: responseSummary,
            rawResponse: XDR_RICH_METHODS.has(methodName) ? result : undefined,
            durationMs: performance.now() - startTime,
            status: "success",
          });

          return result;
        } catch (error) {
          addLog({
            timestamp: new Date(),
            method: methodName,
            request: requestSummary,
            response: { error: String(error) },
            rawResponse: undefined,
            durationMs: performance.now() - startTime,
            status: "error",
          });

          throw error;
        }
      };
    },
  });
}

// Keep fetch interceptor for friendbot calls only
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const isFriendbot = url.includes("friendbot.stellar.org");

  if (!isFriendbot) {
    return originalFetch(input, init);
  }

  const startTime = performance.now();

  try {
    const response = await originalFetch(input, init);
    const cloned = response.clone();
    let rawBody: unknown;
    try {
      rawBody = await cloned.json();
    } catch {
      rawBody = undefined;
    }

    addLog({
      timestamp: new Date(),
      method: "friendbot",
      request: { url },
      response: { status: response.status },
      rawResponse: rawBody,
      durationMs: performance.now() - startTime,
      status: response.ok ? "success" : "error",
    });

    return response;
  } catch (error) {
    addLog({
      timestamp: new Date(),
      method: "friendbot",
      request: { url },
      response: { error: String(error) },
      rawResponse: undefined,
      durationMs: performance.now() - startTime,
      status: "error",
    });

    throw error;
  }
};
