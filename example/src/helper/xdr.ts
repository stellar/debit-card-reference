import { scValToNative, Address, xdr } from "@stellar/stellar-sdk";

export interface AuthEntryInfo {
  credential: string;
  contract: string;
  function: string;
  args: string[];
}

export interface EventInfo {
  type: string;
  /** Contract event name (first topic symbol), when present. */
  name?: string;
  topics: string[];
  data: string;
}

export interface ResourceCost {
  minResourceFee: string;
  cpuInsns: string;
  memBytes: string;
}

export interface TxResultInfo {
  feeCharged: string;
  resultCode: string;
  operations: string[];
}

function formatNative(val: unknown): string {
  if (val === undefined || val === null) return "null";
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  if (val instanceof Uint8Array) {
    return Array.from(val)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  try {
    return JSON.stringify(val, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Uint8Array) {
        return Array.from(v).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      if (v?.type === "Buffer" && Array.isArray(v?.data)) {
        return (v.data as number[]).map((b: number) => b.toString(16).padStart(2, "0")).join("");
      }
      return v;
    }, 2);
  } catch {
    return String(val);
  }
}

function safeScValToNative(scVal: xdr.ScVal): string {
  try {
    return formatNative(scValToNative(scVal));
  } catch {
    try {
      return scVal.toXDR("base64");
    } catch {
      return "[unknown ScVal]";
    }
  }
}

export function decodeReturnValue(raw: unknown): string | null {
  try {
    const r = raw as Record<string, unknown>;
    // SimulateTransactionSuccessResponse: result.retval
    const result = r?.result as Record<string, unknown> | undefined;
    if (result?.retval) {
      return safeScValToNative(result.retval as xdr.ScVal);
    }
    // GetSuccessfulTransactionResponse: returnValue
    if (r?.returnValue) {
      return safeScValToNative(r.returnValue as xdr.ScVal);
    }
    return null;
  } catch {
    return null;
  }
}

export function decodeResourceCost(raw: unknown): ResourceCost | null {
  try {
    const r = raw as Record<string, unknown>;
    const fee = r?.minResourceFee as string | undefined;
    if (!fee) return null;
    const cost = r?.cost as { cpuInsns: string; memBytes: string } | undefined;
    return {
      minResourceFee: fee,
      cpuInsns: cost?.cpuInsns ?? "n/a",
      memBytes: cost?.memBytes ?? "n/a",
    };
  } catch {
    return null;
  }
}

function decodeScAddress(addr: xdr.ScAddress): string {
  try {
    return Address.fromScAddress(addr).toString();
  } catch {
    return "unknown";
  }
}

export function decodeAuthEntries(raw: unknown): AuthEntryInfo[] | null {
  try {
    const r = raw as Record<string, unknown>;
    const result = r?.result as Record<string, unknown> | undefined;
    const auth = result?.auth as xdr.SorobanAuthorizationEntry[] | undefined;
    if (!auth?.length) return null;

    return auth.map((entry) => {
      try {
        const cred = entry.credentials();
        let credential = "sourceAccount";
        if (cred.switch().name === "sorobanCredentialsAddress") {
          credential = decodeScAddress(cred.address().address());
        }

        const inv = entry.rootInvocation();
        const contractFn = inv.function().contractFn();
        const contract = decodeScAddress(contractFn.contractAddress());
        const fn = contractFn.functionName().toString();
        const args = contractFn.args().map((a: xdr.ScVal) => safeScValToNative(a));
        return { credential, contract, function: fn, args };
      } catch {
        return { credential: "unknown", contract: "unknown", function: "unknown", args: [] };
      }
    });
  } catch {
    return null;
  }
}

function eventNameFromTopics(topics: xdr.ScVal[]): string | undefined {
  try {
    const first = topics[0];
    if (first?.switch() === xdr.ScValType.scvSymbol()) {
      return first.sym().toString();
    }
  } catch {
    // fall through
  }
  return undefined;
}

function decodeContractEventBody(event: xdr.ContractEvent): EventInfo {
  try {
    const type = event.type().name;
    const body = event.body().v0();
    const name = eventNameFromTopics(body.topics());
    const topics = body.topics().map((t) => safeScValToNative(t));
    const data = safeScValToNative(body.data());
    return { type, name, topics, data };
  } catch {
    return { type: "unknown", topics: [], data: "decode error" };
  }
}

// Decodes an event as returned by RPC `getEvents` (already-parsed ScVals).
export function decodeRpcEvent(
  topics: xdr.ScVal[],
  value: xdr.ScVal,
): EventInfo {
  return {
    type: "contract",
    name: eventNameFromTopics(topics),
    topics: topics.map((t) => safeScValToNative(t)),
    data: safeScValToNative(value),
  };
}

export function decodeDiagnosticEvents(raw: unknown): EventInfo[] | null {
  try {
    const r = raw as Record<string, unknown>;
    const events = r?.events as xdr.DiagnosticEvent[] | undefined;
    if (!events?.length) return null;
    return events.map((evt) => {
      try {
        return decodeContractEventBody(evt.event());
      } catch {
        return { type: "unknown", topics: [], data: "decode error" };
      }
    });
  } catch {
    return null;
  }
}

export function decodeTransactionResult(raw: unknown): TxResultInfo | null {
  try {
    const r = raw as Record<string, unknown>;
    const resultXdr = r?.resultXdr as xdr.TransactionResult | undefined;
    if (!resultXdr) return null;

    const feeCharged = resultXdr.feeCharged().toString();
    const resultCode = resultXdr.result().switch().name;

    let operations: string[] = [];
    try {
      const results = resultXdr.result().results();
      if (results) {
        operations = results.map((op) => {
          try {
            return op.tr()?.switch()?.name ?? "unknown";
          } catch {
            return "unknown";
          }
        });
      }
    } catch {
      // result code may not have operation results
    }

    return { feeCharged, resultCode, operations };
  } catch {
    return null;
  }
}

export function decodeTransactionEvents(raw: unknown): EventInfo[] | null {
  try {
    const r = raw as Record<string, unknown>;
    // Prefer diagnosticEventsXdr (already parsed by SDK)
    const diagEvents = r?.diagnosticEventsXdr as xdr.DiagnosticEvent[] | undefined;
    if (diagEvents?.length) {
      return diagEvents.map((evt) => {
        try {
          return decodeContractEventBody(evt.event());
        } catch {
          return { type: "unknown", topics: [], data: "decode error" };
        }
      });
    }

    // Fallback: extract from resultMetaXdr v3 sorobanMeta
    const meta = r?.resultMetaXdr as xdr.TransactionMeta | undefined;
    if (!meta) return null;

    try {
      const v3 = meta.v3();
      const sorobanMeta = v3.sorobanMeta();
      if (!sorobanMeta) return null;
      const events = sorobanMeta.events();
      if (!events.length) return null;
      return events.map((event) => decodeContractEventBody(event));
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
