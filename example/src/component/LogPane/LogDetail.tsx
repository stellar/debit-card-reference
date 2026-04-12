import { useState, type ReactNode } from "react";
import type { LogEntry } from "@/types.ts";
import {
  decodeReturnValue,
  decodeAuthEntries,
  decodeResourceCost,
  decodeDiagnosticEvents,
  decodeTransactionResult,
  decodeTransactionEvents,
} from "@/helper/xdr.ts";

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === "bigint") return v.toString();
        if (v instanceof Uint8Array) {
          return Array.from(v)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }
        if (v && typeof v === "object" && "toXDR" in v) {
          try {
            return (v as { toXDR: (f: string) => string }).toXDR("base64");
          } catch {
            return "[XDR Object]";
          }
        }
        return v;
      },
      2,
    );
  } catch {
    return JSON.stringify({ error: "Could not serialize response" });
  }
}

const DetailSection = ({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="LogDetail__section">
      <button
        className="LogDetail__sectionHeader"
        onClick={() => setOpen(!open)}
      >
        <span>
          {title}
          {count != null && (
            <span className="LogDetail__sectionCount">{count}</span>
          )}
        </span>
        <span className="LogDetail__chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="LogDetail__sectionBody">{children}</div>}
    </div>
  );
};

export const LogDetail = ({
  entry,
  onBack,
}: {
  entry: LogEntry;
  onBack: () => void;
}) => {
  const raw = entry.rawResponse;
  const isSimulate = entry.method === "simulateTransaction";
  const isGetTx = entry.method === "getTransaction";

  const returnValue = isSimulate || isGetTx ? decodeReturnValue(raw) : null;
  const authEntries = isSimulate ? decodeAuthEntries(raw) : null;
  const resourceCost = isSimulate ? decodeResourceCost(raw) : null;
  const diagnosticEvents = isSimulate ? decodeDiagnosticEvents(raw) : null;
  const txResult = isGetTx ? decodeTransactionResult(raw) : null;
  const txEvents = isGetTx ? decodeTransactionEvents(raw) : null;

  return (
    <div className="LogDetail">
      <div className="LogDetail__header">
        <button className="LogDetail__back" onClick={onBack}>
          &larr; Back
        </button>
        <span className="LogDetail__method">{entry.method}</span>
        <span className="LogDetail__status" data-status={entry.status}>
          {entry.status}
        </span>
        <span className="LogDetail__duration">
          {entry.durationMs.toFixed(0)}ms
        </span>
      </div>

      <div className="LogDetail__body">
        {returnValue !== null && (
          <DetailSection title="Return Value" defaultOpen>
            <pre className="LogDetail__code">{returnValue}</pre>
          </DetailSection>
        )}

        {authEntries && (
          <DetailSection title="Auth Entries" count={authEntries.length}>
            {authEntries.map((ae, i) => (
              <pre key={i} className="LogDetail__code">
                {`credential: ${ae.credential}\ncontract:   ${ae.contract}\nfunction:   ${ae.function}\nargs:       [${ae.args.join(", ")}]`}
              </pre>
            ))}
          </DetailSection>
        )}

        {resourceCost && (
          <DetailSection title="Resource Cost">
            <pre className="LogDetail__code">
              {`minResourceFee: ${resourceCost.minResourceFee} stroops\ncpuInsns:       ${resourceCost.cpuInsns}\nmemBytes:       ${resourceCost.memBytes}`}
            </pre>
          </DetailSection>
        )}

        {diagnosticEvents && (
          <DetailSection title="Events" count={diagnosticEvents.length}>
            {diagnosticEvents.map((evt, i) => (
              <pre key={i} className="LogDetail__code">
                {`${i}: ${evt.type}\n  topics: [${evt.topics.join(", ")}]\n  data:   ${evt.data}`}
              </pre>
            ))}
          </DetailSection>
        )}

        {txResult && (
          <DetailSection title="Transaction Result" defaultOpen>
            <pre className="LogDetail__code">
              {`feeCharged: ${txResult.feeCharged}\nresult:     ${txResult.resultCode}\noperations: [${txResult.operations.join(", ")}]`}
            </pre>
          </DetailSection>
        )}

        {txEvents && (
          <DetailSection title="Contract Events" count={txEvents.length}>
            {txEvents.map((evt, i) => (
              <pre key={i} className="LogDetail__code">
                {`${i}: ${evt.type}\n  topics: [${evt.topics.join(", ")}]\n  data:   ${evt.data}`}
              </pre>
            ))}
          </DetailSection>
        )}

        <DetailSection title="Raw JSON">
          <pre className="LogDetail__code">
            {safeStringify(entry.rawResponse ?? entry.response)}
          </pre>
        </DetailSection>
      </div>
    </div>
  );
};
