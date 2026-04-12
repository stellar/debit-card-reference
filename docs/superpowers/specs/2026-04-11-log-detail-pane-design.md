# Log Detail Pane with XDR Deserialization

## Summary

Add a detail view to the LogPane that replaces the log list when a user clicks an entry. The detail view deserializes XDR data from Soroban RPC responses into human-readable sections (return values, auth entries, events, resource costs, transaction results). A back button returns to the log list. No layout shift — the detail view occupies the same space as the log list.

## Data Layer

### Extended LogEntry type

Add an optional `rawResponse` field to `LogEntry` in `types.ts`:

```typescript
export interface LogEntry {
  id: number;
  timestamp: Date;
  method: string;
  request: unknown;
  response: unknown;
  rawResponse?: unknown;   // Full SDK response for XDR-rich methods
  durationMs: number;
  status: "success" | "error";
}
```

### Updated logging proxy (`soroban/client.ts`)

For three XDR-rich methods, capture the full response alongside the existing summary:

| Method | What to capture in `rawResponse` |
|--------|----------------------------------|
| `simulateTransaction` | Full `SimulateTransactionResponse` — contains `result.retval`, `result.auth`, `events`, `minResourceFee`, `cost`, `transactionData` |
| `getTransaction` | Full `GetTransactionResponse` — contains `returnValue`, `resultXdr`, `resultMetaXdr` |
| `sendTransaction` | Full `SendTransactionResponse` — contains `hash`, `status`, `errorResult` |

All other methods (`getAccount`, `getLatestLedger`, etc.) keep `rawResponse` as `undefined`. The `friendbot` logger also captures its full JSON response.

Response objects are stored in React state (in-memory only). Parsed XDR objects from the SDK maintain their prototypes. This is a dev tool — memory from stored responses is not a concern.

### Updated ADD_LOG action type

```typescript
| { type: "ADD_LOG"; entry: Omit<LogEntry, "id"> }
```

No change needed — the existing action type already accepts `Omit<LogEntry, "id">`, and `rawResponse` is optional.

## New File: `helper/xdr.ts`

Pure functions that extract and format XDR data from raw SDK responses. Every function is wrapped in try/catch and returns a fallback on failure.

### Functions

**`decodeReturnValue(rawResponse: unknown): string | object | null`**
- Extracts `result?.retval` (simulation) or `returnValue` (transaction)
- Uses `scValToNative()` from stellar-sdk to convert to JS-native
- Returns `null` if not present or decoding fails

**`decodeAuthEntries(rawResponse: unknown): AuthEntryInfo[] | null`**
- Extracts `result?.auth` from simulation response (base64 string array)
- Decodes each `SorobanAuthorizationEntry` from base64
- Returns array of `{ credential: string, contract: string, function: string, args: string[] }`
- Returns `null` if not present

**`decodeDiagnosticEvents(rawResponse: unknown): EventInfo[] | null`**
- Extracts `events` from simulation response (base64 string array)
- Decodes each `DiagnosticEvent` from base64
- Returns array of `{ type: "contract" | "diagnostic", topics: string[], data: string }`
- Returns `null` if not present

**`decodeResourceCost(rawResponse: unknown): ResourceCost | null`**
- Extracts `minResourceFee` and `cost` from simulation response
- Returns `{ minResourceFee: string, cpuInsns: string, memBytes: string }`

**`decodeTransactionResult(rawResponse: unknown): TxResultInfo | null`**
- Extracts `resultXdr` from getTransaction response
- Decodes fee charged, result code, operation results
- Returns structured object

**`decodeTransactionEvents(rawResponse: unknown): EventInfo[] | null`**
- Extracts events from `resultMetaXdr` (TransactionMeta v3)
- Decodes contract events with topics and data
- Returns same `EventInfo[]` shape as diagnostic events

### Display types

```typescript
interface AuthEntryInfo {
  credential: string;
  contract: string;
  function: string;
  args: string[];
}

interface EventInfo {
  type: string;
  topics: string[];
  data: string;
}

interface ResourceCost {
  minResourceFee: string;
  cpuInsns: string;
  memBytes: string;
}

interface TxResultInfo {
  feeCharged: string;
  resultCode: string;
  operations: string[];
}
```

## New Component: `LogDetail` (`component/LogPane/LogDetail.tsx`)

### Props

```typescript
interface LogDetailProps {
  entry: LogEntry;
  onBack: () => void;
}
```

### Rendering logic

1. **Header**: back button, method name, status badge (success/error), duration, timestamp
2. **Adaptive sections based on `entry.method`**:

| Method | Sections |
|--------|----------|
| `simulateTransaction` | Return Value, Auth Entries, Resource Cost, Events, Raw JSON |
| `getTransaction` | Return Value, Transaction Result, Contract Events, Raw JSON |
| `sendTransaction` | Status, Hash, Raw JSON |
| `getAccount`, `getLatestLedger`, etc. | Raw JSON |
| `friendbot` | Status, URL, Raw JSON |

3. Each section is a collapsible block with a header label and monospace content
4. **Raw JSON** section always present — shows `JSON.stringify(entry.rawResponse ?? entry.response, null, 2)` as a scrollable pre block

### Section component

Each section is rendered by a small `DetailSection` sub-component:

```typescript
interface DetailSectionProps {
  title: string;
  count?: number;        // e.g. "Auth Entries (2)"
  defaultOpen?: boolean; // first section open by default
  children: ReactNode;
}
```

Renders a clickable header that toggles visibility of children. Uses local `useState<boolean>`.

## Updated Component: `LogPane` (`component/LogPane/index.tsx`)

### Changes

1. Add `selectedLogId: number | null` local state (initially `null`)
2. When `selectedLogId` is `null`: render existing log list (current behavior)
3. When `selectedLogId` is set: find the entry, render `<LogDetail entry={entry} onBack={() => setSelectedLogId(null)} />`
4. Each `LogEntryItem` gets `onClick={() => setSelectedLogId(entry.id)}`
5. Remove the existing inline expand/collapse from `LogEntryItem` — clicking now navigates to detail view instead

## Styling

Add to `style/global.scss` (within the existing LogPane section):

- `.LogDetail` — full-height container with flex column layout
- `.LogDetail__header` — sticky header with back button, method, status badge, duration
- `.LogDetail__body` — scrollable content area
- `.LogDetail__section` — collapsible section with header toggle
- `.LogDetail__sectionHeader` — purple uppercase label, clickable, with chevron
- `.LogDetail__code` — dark background monospace block (`background: var(--sds-clr-gray-02)`, `border-radius`, `padding`, `overflow-x: auto`)

Reuse existing design system variables for colors. The detail view inherits the same width and height constraints as the current log list.

## Method-to-section mapping (complete)

```
simulateTransaction:
  ├── Return Value      → decodeReturnValue()
  ├── Auth Entries      → decodeAuthEntries()
  ├── Resource Cost     → decodeResourceCost()
  ├── Events            → decodeDiagnosticEvents()
  └── Raw JSON          → entry.rawResponse ?? entry.response

getTransaction:
  ├── Return Value      → decodeReturnValue()
  ├── Tx Result         → decodeTransactionResult()
  ├── Contract Events   → decodeTransactionEvents()
  └── Raw JSON          → entry.rawResponse ?? entry.response

sendTransaction:
  └── Raw JSON          → entry.rawResponse ?? entry.response

getAccount / getLatestLedger / getHealth / ...:
  └── Raw JSON          → entry.response

friendbot:
  └── Raw JSON          → entry.rawResponse ?? entry.response
```

## File inventory

| File | Action | Purpose |
|------|--------|---------|
| `src/types.ts` | Edit | Add `rawResponse?` to `LogEntry` |
| `src/soroban/client.ts` | Edit | Capture full response for XDR-rich methods |
| `src/helper/xdr.ts` | Create | XDR deserialization utilities |
| `src/component/LogPane/LogDetail.tsx` | Create | Detail view component |
| `src/component/LogPane/index.tsx` | Edit | Add selected state, toggle list/detail |
| `src/style/global.scss` | Edit | Detail pane styles |

## Error handling

- All XDR decoding functions use try/catch; failures render "Could not decode" with the raw base64 shown as fallback
- If `rawResponse` is undefined (older log entries from before this feature), the detail view gracefully falls back to showing just the summarized `request`/`response` as JSON
- The back button is always accessible regardless of decoding failures

## Out of scope

- Persisting logs across page reloads (logs are already ephemeral)
- Filtering or searching within the detail view
- Copying individual decoded sections (the existing "Copy All" on the log list is sufficient)
