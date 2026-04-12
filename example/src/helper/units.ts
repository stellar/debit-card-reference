import { useRef, useEffect, type Dispatch, type SetStateAction } from "react";

export type DisplayUnits = "stroops" | "xlm";

const STROOPS_PER_XLM = 10_000_000n;

export function formatAmount(stroops: string, units: DisplayUnits): string {
  if (units === "stroops") return stroops;
  const val = BigInt(stroops);
  const whole = val / STROOPS_PER_XLM;
  const frac = val % STROOPS_PER_XLM;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function parseAmount(input: string, units: DisplayUnits): bigint {
  if (units === "stroops") return BigInt(input);
  const parts = input.split(".");
  const whole = BigInt(parts[0] || "0") * STROOPS_PER_XLM;
  if (parts.length === 1) return whole;
  const fracStr = (parts[1] || "0").padEnd(7, "0").slice(0, 7);
  return whole + BigInt(fracStr);
}

export function unitSuffix(units: DisplayUnits): string {
  return units === "xlm" ? "XLM" : "stroops";
}

export function amountLabel(label: string, units: DisplayUnits): string {
  return `${label} (${unitSuffix(units)})`;
}

export function convertDisplayValue(
  value: string,
  from: DisplayUnits,
  to: DisplayUnits,
): string {
  if (from === to) return value;
  try {
    const stroops = parseAmount(value, from);
    return formatAmount(stroops.toString(), to);
  } catch {
    return value;
  }
}

export function useConvertOnUnitChange(
  units: DisplayUnits,
  ...setters: Dispatch<SetStateAction<string>>[]
): void {
  const prevUnits = useRef(units);
  useEffect(() => {
    if (prevUnits.current !== units) {
      const from = prevUnits.current;
      for (const setter of setters) {
        setter((v) => convertDisplayValue(v, from, units));
      }
      prevUnits.current = units;
    }
  }, [units]);
}
