import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Workspace } from "./types";

export function Preferences() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<string>("");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [newWsName, setNewWsName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ws, as] = await Promise.all([
        api.listWorkspaces(),
        isEnabled().catch(() => false),
      ]);
      setWorkspaces(ws.workspaces);
      setActive(ws.active);
      setAutostart(as);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleAutostart() {
    try {
      if (autostart) {
        await disable();
        setAutostart(false);
      } else {
        await enable();
        setAutostart(true);
      }
    } catch (e) {
      setError(`Autostart: ${e}`);
    }
  }

  async function addWorkspace() {
    const name = newWsName.trim();
    if (!name) return;
    try {
      await api.createWorkspace(name);
      setNewWsName("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeWorkspace(id: string) {
    if (!confirm(`Delete workspace "${id}"? Items stay on disk but become unreachable.`)) return;
    try {
      await api.deleteWorkspace(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="prefs">
      <h1>davidcast preferences</h1>

      {error && (
        <div className="prefs-error">
          {error} <button className="btn" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <h2>General</h2>
      <section>
        <div className="prefs-row">
          <div className="label">
            <div className="label-title">Launch at login</div>
            <div className="label-sub">
              Start davidcast automatically when you sign in.
            </div>
          </div>
          <div
            className={`switch ${autostart ? "on" : ""}`}
            onClick={toggleAutostart}
            role="switch"
            aria-checked={!!autostart}
          />
        </div>
        <div className="prefs-row">
          <div className="label">
            <div className="label-title">Global hotkey</div>
            <div className="label-sub">
              Press <kbd>⌥ Space</kbd> anywhere to toggle the palette. Rebinding
              lands in a later release.
            </div>
          </div>
        </div>
      </section>

      <h2>Workspaces</h2>
      <section>
        {workspaces.map((w) => (
          <div key={w.id} className="prefs-ws">
            <span
              className="ws-dot"
              style={w.color ? { background: w.color } : undefined}
            />
            <span className="ws-name">{w.name}</span>
            {w.id === active && <span className="ws-badge">active</span>}
            {workspaces.length > 1 && (
              <button className="btn danger" onClick={() => removeWorkspace(w.id)}>
                Delete
              </button>
            )}
          </div>
        ))}
        <div className="prefs-add">
          <input
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addWorkspace()}
            placeholder="New workspace name"
          />
          <button className="btn primary" onClick={addWorkspace}>
            Add
          </button>
        </div>
      </section>

      <div className="prefs-meta">
        Store:{" "}
        <code>~/Library/Application Support/davidcast/</code>
      </div>
    </div>
  );
}
