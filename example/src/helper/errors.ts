const FACTORY_ERRORS: Record<number, string> = {
  0: "Debitor is not authorized for this issuer",
  1: "Destination is not on the allowlist for this issuer",
  2: "Velocity configuration is invalid (period < 3600s, per-tx limit > period limit, or negative limit)",
  3: "Transfer amount is invalid (must be > 0)",
  4: "Transfer exceeds per-transaction spend limit",
  5: "Transfer exceeds the fixed-window period spend limit",
  6: "Only one transfer per ledger is allowed for this user",
  7: "Issuer not found for this (issuer_id, token) pair",
  8: "Issuer manager not found",
  9: "Issuer already exists for this (issuer_id, token) pair",
  1000: "Contract is paused",
  1001: "Contract is not paused",
};

const TOKEN_HINTS: Record<string, (args: string[]) => string> = {
  "not enough allowance to spend": (args) => {
    if (args.length >= 2) {
      return `Insufficient allowance: have ${args[0]} stroops, need ${args[1]} stroops`;
    }
    return "Insufficient token allowance";
  },
  "not enough balance": (args) => {
    if (args.length >= 2) {
      return `Insufficient balance: have ${args[0]} stroops, need ${args[1]} stroops`;
    }
    return "Insufficient token balance";
  },
};

function extractDiagnosticHint(raw: string): string | null {
  for (const [key, formatter] of Object.entries(TOKEN_HINTS)) {
    const idx = raw.indexOf(key);
    if (idx === -1) continue;
    const after = raw.slice(idx + key.length);
    const nums = after.match(/\d+/g) ?? [];
    return formatter(nums);
  }
  return null;
}

function extractContractError(raw: string): number | null {
  const match = raw.match(/Error\(Contract, #(\d+)\)/);
  return match ? parseInt(match[1], 10) : null;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function parseSimulationError(raw: string): string {
  const code = extractContractError(raw);
  const hint = extractDiagnosticHint(raw);

  if (hint) return hint;
  if (code !== null && FACTORY_ERRORS[code]) return FACTORY_ERRORS[code];
  if (code !== null) return `Contract error #${code}`;

  return raw;
}
