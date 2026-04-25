import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { api, type Settings } from "./api";
import type { Workspace } from "./types";

export function Preferences() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<string>("");
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [newWsName, setNewWsName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ws, as, s] = await Promise.all([
        api.listWorkspaces(),
        isEnabled().catch(() => false),
        api.getSettings(),
      ]);
      setWorkspaces(ws.workspaces);
      setActive(ws.active);
      setAutostart(as);
      setSettings(s);
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

  async function toggleViteInline() {
    if (!settings) return;
    const next = !settings.show_vite_inline;
    setSettings({ ...settings, show_vite_inline: next });
    try {
      await api.setShowViteInline(next);
    } catch (e) {
      setError(String(e));
      setSettings({ ...settings, show_vite_inline: !next });
    }
  }

  async function toggleDockerInline() {
    if (!settings) return;
    const next = !settings.show_docker_inline;
    setSettings({ ...settings, show_docker_inline: next });
    try {
      await api.setShowDockerInline(next);
    } catch (e) {
      setError(String(e));
      setSettings({ ...settings, show_docker_inline: !next });
    }
  }

  async function saveScreenshotDirs(value: string) {
    if (!settings) return;
    const dirs = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSettings({ ...settings, screenshot_dirs: dirs });
    try {
      await api.setScreenshotDirs(dirs);
    } catch (e) {
      setError(String(e));
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

      <h2>Plugins</h2>
      <section>
        <div className="prefs-row">
          <div className="label">
            <div className="label-title">Show Vite ports inline</div>
            <div className="label-sub">
              Running Vite dev servers appear in the main palette list. When
              off, find them via the <b>Show Vite Ports</b> command.
            </div>
          </div>
          <div
            className={`switch ${settings?.show_vite_inline ? "on" : ""}`}
            onClick={toggleViteInline}
            role="switch"
            aria-checked={!!settings?.show_vite_inline}
          />
        </div>
        <div className="prefs-row">
          <div className="label">
            <div className="label-title">Show Docker containers inline</div>
            <div className="label-sub">
              Running containers appear in the main list with two rows each
              (shell + logs). When off, reach them via the <b>Show Docker
              Containers</b> command.
            </div>
          </div>
          <div
            className={`switch ${settings?.show_docker_inline ? "on" : ""}`}
            onClick={toggleDockerInline}
            role="switch"
            aria-checked={!!settings?.show_docker_inline}
          />
        </div>
        <div className="prefs-row">
          <div className="label">
            <div className="label-title">Screenshot folders</div>
            <div className="label-sub">
              Where <b>Find Screenshots</b> looks. Comma-separated absolute
              paths. macOS default is <code>~/Desktop</code>; some setups
              redirect to <code>~/Pictures/Screenshots</code> via{" "}
              <code>defaults write com.apple.screencapture location</code>.
            </div>
          </div>
          <input
            className="prefs-input"
            defaultValue={settings?.screenshot_dirs.join(", ") ?? ""}
            placeholder="/Users/you/Desktop, /Users/you/Pictures/Screenshots"
            onBlur={(e) => saveScreenshotDirs(e.target.value)}
          />
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

      <h2>Import</h2>
      <ImportSection onError={setError} />

      <div className="prefs-meta">
        Store: <code>~/Library/Application Support/davidcast/</code>
      </div>
    </div>
  );
}

function ImportSection({ onError }: { onError: (s: string) => void }) {
  const [raycastInstalled, setRaycastInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api
      .detectRaycast()
      .then((r) => setRaycastInstalled(r.installed))
      .catch(() => setRaycastInstalled(false));
  }, []);

  async function pickAndImport() {
    if (busy) return;
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [{ name: "JSON", extensions: ["json"] }],
        title: "Pick Raycast export file(s)",
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;
      setBusy(true);
      setResult(null);
      let totalS = 0,
        totalQ = 0,
        totalSkip = 0;
      for (const p of paths) {
        const r = await api.importFromFile(p);
        totalS += r.snippets;
        totalQ += r.quicklinks;
        totalSkip += r.skipped;
      }
      setResult(
        `Imported ${totalS} snippet(s), ${totalQ} quicklink(s)` +
          (totalSkip ? `, skipped ${totalSkip}` : "") +
          " into the active workspace."
      );
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openRaycast() {
    try {
      await api.executeApp("/Applications/Raycast.app");
    } catch {
      /* ignore */
    }
  }

  return (
    <section>
      <div className="prefs-row">
        <div className="label">
          <div className="label-title">
            {raycastInstalled === null
              ? "Looking for Raycast…"
              : raycastInstalled
              ? "Raycast detected"
              : "Import from JSON"}
          </div>
          <div className="label-sub">
            {raycastInstalled ? (
              <>
                Raycast's data lives in an encrypted database, so we can't read
                it directly. Export its JSON once and we'll take it from there:
                <ol style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  <li>
                    Open Raycast, search <b>Export Quicklinks</b>, save the
                    JSON somewhere you can find it.
                  </li>
                  <li>
                    Same for <b>Export Snippets</b>.
                  </li>
                  <li>Click <b>Choose files…</b> below and pick both.</li>
                </ol>
              </>
            ) : (
              <>
                Drop in a JSON array with <code>{"{name, text}"}</code> snippets
                and/or <code>{"{name, link}"}</code> quicklinks. Raycast export
                shapes are auto-detected.
              </>
            )}
          </div>
        </div>
        {raycastInstalled && (
          <button className="btn" onClick={openRaycast}>
            Open Raycast
          </button>
        )}
      </div>

      <div className="prefs-row">
        <div className="label">
          <div className="label-title">Pick export file(s)</div>
          <div className="label-sub">
            You can pick more than one at once (⌘-click to multi-select).
          </div>
        </div>
        <button className="btn primary" onClick={pickAndImport} disabled={busy}>
          {busy ? "Importing…" : "Choose files…"}
        </button>
      </div>

      {result && (
        <div
          style={{
            color: "var(--accent)",
            fontSize: 12,
            padding: "6px 0",
          }}
        >
          ✓ {result}
        </div>
      )}
    </section>
  );
}
