import { useState, useEffect, useCallback } from "react";
import { useAppState, useAppDispatch } from "@/store.ts";
import {
  loadSessionIndex,
  loadSession,
  deleteSession,
  type SessionIndexEntry,
} from "@/helper/sessionStorage.ts";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const SessionPicker = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [sessions, setSessions] = useState<SessionIndexEntry[]>(loadSessionIndex);

  const refresh = useCallback(() => {
    setSessions(loadSessionIndex());
  }, []);

  // Refresh the index when factoryContractId changes (new session saved)
  useEffect(() => {
    // Short delay to let the debounced save in App.tsx flush first
    const timer = setTimeout(refresh, 600);
    return () => clearTimeout(timer);
  }, [state.factoryContractId, refresh]);

  const currentValue = state.factoryContractId ?? "";

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "") {
      dispatch({ type: "RESET_STATE" });
    } else {
      const session = loadSession(value);
      if (session) {
        dispatch({ type: "LOAD_SESSION", session });
      }
    }
  };

  const handleDelete = () => {
    if (!state.factoryContractId) return;
    deleteSession(state.factoryContractId);
    dispatch({ type: "RESET_STATE" });
    refresh();
  };

  if (sessions.length === 0 && !state.factoryContractId) {
    return (
      <div className="SessionPicker">
        <span className="SessionPicker__label">Session</span>
        <span className="SessionPicker__hint">
          Saves automatically when factory is deployed
        </span>
      </div>
    );
  }

  return (
    <div className="SessionPicker">
      <span className="SessionPicker__label">Session</span>
      <select
        className="SessionPicker__select"
        value={currentValue}
        onChange={handleChange}
      >
        <option value="">New Session</option>
        {sessions.map((s) => (
          <option key={s.factoryContractId} value={s.factoryContractId}>
            {s.label} ({relativeTime(s.updatedAt)})
          </option>
        ))}
      </select>
      {state.factoryContractId && (
        <button className="SessionPicker__delete" onClick={handleDelete}>
          Delete
        </button>
      )}
    </div>
  );
};
