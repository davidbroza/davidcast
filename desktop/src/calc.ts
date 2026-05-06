/**
 * Inline calculator. Evaluates arithmetic expressions typed into the
 * palette. Pure frontend, no deps.
 *
 * Supports:
 *   1+1, 2*3, 100/4, 2^10 (power), (1+2)*3, 50%, 100 + 10%, sqrt(16)
 *   "10% of 100"   → 10
 *   "what is 7*8"  → 56     (strips a leading natural-language preamble)
 *
 * Approach:
 *  1. Strip a small set of natural-language prefixes ("what is", "calc")
 *  2. Convert "X% of Y" → "(X/100)*Y"
 *  3. Convert standalone "%" → "/100"
 *  4. Replace "^" with "**"
 *  5. Validate the expression against an allow-list (digits, operators,
 *     whitelisted fn names) and evaluate with `new Function()`.
 *
 * The allow-list keeps `eval`-style risks contained — no identifiers
 * other than the math whitelist make it through, so an attacker can't
 * sneak in `process` or `fetch`.
 */

const FN_WHITELIST = new Set([
  "abs", "ceil", "floor", "round", "sqrt", "log", "log2", "log10",
  "exp", "sin", "cos", "tan", "min", "max", "pow",
]);

const CONST_WHITELIST: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  E: Math.E,
};

export interface CalcResult {
  expr: string;        // normalized expression after preprocessing
  result: string;      // human-readable result ("3.14159…", "1,234")
  raw: number;         // numeric value for clipboard / further math
}

export function evaluateMath(input: string): CalcResult | null {
  if (!input) return null;
  let s = input.trim();
  if (s.length === 0 || s.length > 200) return null;

  // Strip natural-language preamble.
  s = s.replace(/^(what'?s|what is|calc(ulate)?|=)\s+/i, "");
  // Strip a trailing "=" — users type "1+1 =" out of habit. Common
  // enough in our analytics no_results to be the actual top calculator
  // miss.
  s = s.replace(/\s*=\s*$/, "");
  // "X% of Y" / "X% out of Y" → "(X/100)*Y". The "out of" form is what
  // people actually type ("20% out of 100") even though "of" is the
  // mathematically minimal phrasing.
  s = s.replace(/(\d+(?:\.\d+)?)%\s*(?:out\s+of|of)\s*/gi, "($1/100)*");
  // Standalone X% → (X/100). Run AFTER "of" so we don't double-rewrite.
  s = s.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
  // x / × as multiplication. Only when surrounded by digits or
  // whitespace so we don't break identifiers like "exp" or "max".
  s = s.replace(/(?<=\d|\s)[x×](?=\d|\s)/gi, "*");
  // ^ → **  (caret as power)
  s = s.replace(/\^/g, "**");
  // Strip thousand separators between digits ("1,000" → "1000") but keep
  // commas elsewhere intact (function arg lists).
  s = s.replace(/(\d),(\d{3}\b)/g, "$1$2");

  // Validation: only allow digits, dot, whitespace, operators, parens,
  // commas, identifier chars from the whitelists.
  const stripped = s
    .replace(/\b(?:abs|ceil|floor|round|sqrt|log|log2|log10|exp|sin|cos|tan|min|max|pow|pi|PI|e|E)\b/g, "")
    .replace(/[\d.\s+\-*/(),]/g, "")
    .replace(/\*\*/g, "");
  if (stripped.length > 0) return null;
  // Must contain at least one digit OR a constant.
  if (!/\d|pi|PI|\be\b|\bE\b/.test(s)) return null;
  // Must contain at least one operator OR be a function call. A bare
  // number isn't a "calculation" — surface it only if the user wrote
  // an expression.
  if (!/[+\-*/^%(]|sqrt|abs|ceil|floor|round|log|exp|sin|cos|tan|min|max|pow/.test(s)) {
    return null;
  }

  // Build an evaluator scope with whitelisted names.
  const scope: Record<string, unknown> = { ...CONST_WHITELIST };
  for (const name of FN_WHITELIST) {
    scope[name] = (Math as unknown as Record<string, unknown>)[name];
  }

  let value: number;
  try {
    const argNames = Object.keys(scope);
    const argValues = Object.values(scope);
    const fn = new Function(...argNames, `"use strict"; return (${s});`);
    value = fn(...argValues) as number;
  } catch {
    return null;
  }
  if (typeof value !== "number" || !isFinite(value)) return null;

  return {
    expr: s,
    result: formatNumber(value),
    raw: value,
  };
}

function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) {
    return n.toLocaleString("en-US");
  }
  // Trim trailing zeros from a fixed decimal representation.
  const fixed = n.toPrecision(10).replace(/\.?0+$/, "");
  const num = parseFloat(fixed);
  return num.toLocaleString("en-US", { maximumFractionDigits: 10 });
}
