import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SystemStats } from "../types";
import { Screen } from "./Screen";

type Props = {
  onClose: () => void;
  onError: (msg: string) => void;
};

const REFRESH_MS = 2000;

function fmtBytes(n: number): string {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pct(used: number, total: number): number {
  if (!total) return 0;
  return Math.round((used / total) * 100);
}

function Bar({
  fraction,
  tone,
}: {
  fraction: number;
  tone?: "ok" | "warn" | "crit";
}) {
  const f = Math.max(0, Math.min(1, fraction));
  const fillVar =
    tone === "crit"
      ? "var(--danger)"
      : tone === "warn"
      ? "var(--badge-clipboard)"
      : "var(--accent)";
  return (
    <div className="stats-bar">
      <div
        className="stats-bar-fill"
        style={{ width: `${f * 100}%`, background: fillVar }}
      />
    </div>
  );
}

export function Stats({ onClose, onError }: Props) {
  const [data, setData] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const timerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.systemStats();
      setData(s);
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Light auto-refresh while the view is open. Pure shell-outs in
  // stats.rs — cheap enough that 2s feels live without taxing anything.
  useEffect(() => {
    if (!auto) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setInterval(() => {
      refresh();
    }, REFRESH_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [auto, refresh]);

  async function copyAsText() {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`${data.host_name} — ${data.os_version}`);
    lines.push(`${data.model} · ${data.cpu_brand} · ${data.cpu_count} cores`);
    lines.push(`Uptime: ${fmtUptime(data.uptime_secs)}`);
    lines.push("");
    lines.push(
      `CPU load: ${data.load_1m.toFixed(2)} / ${data.load_5m.toFixed(2)} / ${data.load_15m.toFixed(2)} (1m / 5m / 15m)`,
    );
    lines.push(
      `Memory:   ${fmtBytes(data.mem_used)} / ${fmtBytes(data.mem_total)} (${pct(
        data.mem_used,
        data.mem_total,
      )}%)${data.mem_pressure ? ` — ${data.mem_pressure}` : ""}`,
    );
    lines.push(
      `Disk ${data.disk_path}: ${fmtBytes(data.disk_used)} / ${fmtBytes(data.disk_total)} (${pct(
        data.disk_used,
        data.disk_total,
      )}%)`,
    );
    if (data.battery_percent != null) {
      lines.push(
        `Battery: ${data.battery_percent}% — ${data.battery_state ?? "unknown"}${
          data.battery_time_remaining ? ` (${data.battery_time_remaining})` : ""
        }`,
      );
    }
    if (data.thermal_pressure) {
      lines.push(`Thermal: ${data.thermal_pressure}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch (e) {
      onError(String(e));
    }
  }

  const memFraction = data ? data.mem_used / Math.max(1, data.mem_total) : 0;
  const diskFraction = data ? data.disk_used / Math.max(1, data.disk_total) : 0;
  // Per-core load: load_1m / cpu_count is the standard "% busy" mapping
  // when load == cores → 100%.
  const cpuFraction = data
    ? Math.min(1, data.load_1m / Math.max(1, data.cpu_count))
    : 0;

  return (
    <Screen kind="stats" title="System Stats" onClose={onClose}>
      <div className="stats">
          {loading && !data && <p className="stats-empty">Loading…</p>}
          {data && (
            <>
              <section className="stats-section">
                <div className="stats-section-head">
                  <h2>Host</h2>
                  <div className="stats-actions">
                    <label className="stats-auto">
                      <input
                        type="checkbox"
                        checked={auto}
                        onChange={(e) => setAuto(e.target.checked)}
                      />
                      auto-refresh
                    </label>
                    <button type="button" onClick={refresh}>
                      Refresh
                    </button>
                    <button type="button" onClick={copyAsText}>
                      Copy
                    </button>
                  </div>
                </div>
                <div className="stats-grid">
                  <div className="stats-cell">
                    <div className="stats-label">Host</div>
                    <div className="stats-value">{data.host_name}</div>
                  </div>
                  <div className="stats-cell">
                    <div className="stats-label">OS</div>
                    <div className="stats-value">{data.os_version}</div>
                  </div>
                  <div className="stats-cell">
                    <div className="stats-label">Model</div>
                    <div className="stats-value">{data.model || "—"}</div>
                  </div>
                  <div className="stats-cell">
                    <div className="stats-label">CPU</div>
                    <div className="stats-value">
                      {data.cpu_brand || "—"}
                      <span className="stats-sub">
                        {" "}
                        · {data.cpu_count} cores
                      </span>
                    </div>
                  </div>
                  <div className="stats-cell">
                    <div className="stats-label">Uptime</div>
                    <div className="stats-value">
                      {fmtUptime(data.uptime_secs)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="stats-section">
                <h2>CPU</h2>
                <Bar
                  fraction={cpuFraction}
                  tone={
                    cpuFraction > 0.9 ? "crit" : cpuFraction > 0.6 ? "warn" : "ok"
                  }
                />
                <div className="stats-row">
                  <span>
                    Load: <b>{data.load_1m.toFixed(2)}</b> ·{" "}
                    {data.load_5m.toFixed(2)} · {data.load_15m.toFixed(2)}
                  </span>
                  <span className="stats-sub">
                    {Math.round(cpuFraction * 100)}% of {data.cpu_count} cores
                  </span>
                </div>
                {data.thermal_pressure && (
                  <div className="stats-row">
                    <span>Thermal</span>
                    <span
                      className={
                        data.thermal_pressure === "Nominal"
                          ? "stats-ok"
                          : "stats-warn"
                      }
                    >
                      {data.thermal_pressure}
                    </span>
                  </div>
                )}
              </section>

              <section className="stats-section">
                <h2>Memory</h2>
                <Bar
                  fraction={memFraction}
                  tone={
                    memFraction > 0.9 ? "crit" : memFraction > 0.75 ? "warn" : "ok"
                  }
                />
                <div className="stats-row">
                  <span>
                    <b>{fmtBytes(data.mem_used)}</b> used of{" "}
                    {fmtBytes(data.mem_total)}
                  </span>
                  <span className="stats-sub">
                    {pct(data.mem_used, data.mem_total)}%
                    {data.mem_pressure ? ` · ${data.mem_pressure}` : ""}
                  </span>
                </div>
              </section>

              <section className="stats-section">
                <h2>Disk ({data.disk_path})</h2>
                <Bar
                  fraction={diskFraction}
                  tone={
                    diskFraction > 0.9
                      ? "crit"
                      : diskFraction > 0.75
                      ? "warn"
                      : "ok"
                  }
                />
                <div className="stats-row">
                  <span>
                    <b>{fmtBytes(data.disk_used)}</b> used of{" "}
                    {fmtBytes(data.disk_total)}
                  </span>
                  <span className="stats-sub">
                    {pct(data.disk_used, data.disk_total)}%
                  </span>
                </div>
              </section>

              {data.battery_percent != null && (
                <section className="stats-section">
                  <h2>Battery</h2>
                  <Bar
                    fraction={(data.battery_percent ?? 0) / 100}
                    tone={
                      (data.battery_percent ?? 100) < 15
                        ? "crit"
                        : (data.battery_percent ?? 100) < 30
                        ? "warn"
                        : "ok"
                    }
                  />
                  <div className="stats-row">
                    <span>
                      <b>{data.battery_percent}%</b>
                      {data.battery_state ? ` — ${data.battery_state}` : ""}
                    </span>
                    {data.battery_time_remaining && (
                      <span className="stats-sub">
                        {data.battery_time_remaining}
                      </span>
                    )}
                  </div>
                </section>
              )}

              <p className="stats-foot">
                One snapshot per refresh — {auto ? `auto every ${REFRESH_MS / 1000}s` : "manual"}. Pure
                shell-outs (sysctl / vm_stat / df / pmset). Local only.
              </p>
            </>
          )}
      </div>
    </Screen>
  );
}
