import { useRef, useEffect, useState } from "react";
import { Button } from "@stellar/design-system";

import { useAppState, useAppDispatch } from "@/store.ts";
import type { LogEntry } from "@/types.ts";
import { LogDetail } from "./LogDetail.tsx";

import "./styles.scss";

const LogEntryItem = ({
  entry,
  onClick,
}: {
  entry: LogEntry;
  onClick: () => void;
}) => (
  <button
    className="LogPane__entry"
    data-status={entry.status}
    onClick={onClick}
  >
    <span className="LogPane__entryMethod">{entry.method}</span>
    <span className="LogPane__entryDuration">
      {entry.durationMs.toFixed(0)}ms
    </span>
    <span className="LogPane__entryChevron">▸</span>
  </button>
);

export const LogPane = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedLogId === null) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [state.logs.length, selectedLogId]);

  const selectedEntry = selectedLogId !== null
    ? state.logs.find((l) => l.id === selectedLogId) ?? null
    : null;

  // If selected entry was cleared, go back to list
  useEffect(() => {
    if (selectedLogId !== null && !selectedEntry) {
      setSelectedLogId(null);
    }
  }, [selectedLogId, selectedEntry]);

  const copyAll = () => {
    const text = state.logs
      .map(
        (l) =>
          `[${l.method}] ${l.status} ${l.durationMs.toFixed(0)}ms\nRequest: ${JSON.stringify(l.request)}\nResponse: ${JSON.stringify(l.response)}`,
      )
      .join("\n\n");
    navigator.clipboard.writeText(text);
  };

  if (selectedEntry) {
    return (
      <div className="LogPane">
        <LogDetail
          entry={selectedEntry}
          onBack={() => setSelectedLogId(null)}
        />
      </div>
    );
  }

  return (
    <div className="LogPane">
      <div className="LogPane__header">
        <span className="LogPane__title">Request Log</span>
        <div className="LogPane__actions">
          <Button
            size="sm"
            variant="tertiary"
            onClick={copyAll}
            disabled={state.logs.length === 0}
          >
            Copy All
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => dispatch({ type: "CLEAR_LOGS" })}
            disabled={state.logs.length === 0}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="LogPane__entries">
        {state.logs.length === 0 && (
          <div className="LogPane__empty">No requests yet</div>
        )}
        {state.logs.map((entry) => (
          <LogEntryItem
            key={entry.id}
            entry={entry}
            onClick={() => setSelectedLogId(entry.id)}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
