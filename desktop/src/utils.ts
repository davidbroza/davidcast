// Pure helpers shared across components. Kept side-effect-free so they
// can be unit-tested without spinning up a DOM.

/// Format a fraction in [0, 1] as an integer percentage. Null/undefined
/// → "—" so dashboard cells stay aligned when a metric isn't available.
export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 100)}%`;
}

/// Friendly duration. Sub-second is "Nms", under a minute is "N.Ns",
/// over a minute is "Nm Ss".
export function fmtMs(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  const m = Math.floor(n / 60_000);
  const s = Math.round((n % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/// Capitalize the first letter — Analytics view uses this on the
/// PaletteEntry["kind"] discriminator strings ("app" → "App").
export function fmtKind(kind: string): string {
  if (!kind) return "";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/// Coarse "N{m,h,d} ago" without pulling in date-fns. now() is injected
/// for deterministic tests.
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/// Bytes → human-friendly. KB binary base (matches what Finder shows).
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
