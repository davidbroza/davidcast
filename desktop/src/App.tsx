import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { api, type Settings } from "./api";
import { ItemForm } from "./components/ItemForm";
import { Palette } from "./components/Palette";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import type { Item, PaletteEntry, Theme, Workspace } from "./types";

/// Set CSS variables on the document root from a theme. Mirrors the
/// `--<name>` shape used in palette.css; everything kept on the root
/// applies to both the palette and prefs windows in this bundle.
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${k}`, v);
  }
}

export type Session = {
  id: string;
  startedAt: number; // ms since epoch
};

function newSession(): Session {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    startedAt: Date.now(),
  };
}

type View =
  | { kind: "palette" }
  | { kind: "create"; presetKind: "snippet" | "quicklink" }
  | { kind: "edit"; item: Item }
  | { kind: "workspace-switcher" };

type InitialFilter = PaletteEntry["kind"] | null;

export default function App() {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>("");
  const [settings, setSettings] = useState<Settings>({
    show_vite_inline: true,
    show_docker_inline: true,
    screenshot_dirs: [],
  });
  const [view, setView] = useState<View>({ kind: "palette" });
  const [error, setError] = useState<string | null>(null);
  const [initialFilter, setInitialFilter] = useState<InitialFilter>(null);
  const [session, setSession] = useState<Session>(() => newSession());

  const refresh = useCallback(async () => {
    const [ws, list, s] = await Promise.all([
      api.listWorkspaces(),
      api.listPalette(),
      api.getSettings(),
    ]);
    setWorkspaces(ws.workspaces);
    setActiveWorkspace(ws.active);
    setEntries(list);
    setSettings(s);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  // Pull and apply the active theme on mount. Failures fall back to the
  // CSS defaults baked into palette.css.
  useEffect(() => {
    api.getActiveTheme().then(applyTheme).catch(() => {});
  }, []);

  useEffect(() => {
    const offShow = listen("palette:show", () => {
      setView({ kind: "palette" });
      setError(null);
      setInitialFilter(null);
      const s = newSession();
      setSession(s);
      api.analyticsRecord(s.id, "open", { via: "hotkey" }).catch(() => {});
      refresh().catch((e) => setError(String(e)));
    });
    const offClipboard = listen("clipboard:show", () => {
      setView({ kind: "palette" });
      setError(null);
      setInitialFilter("clipboard");
      const s = newSession();
      setSession(s);
      api
        .analyticsRecord(s.id, "open", { via: "clipboard_hotkey" })
        .catch(() => {});
      refresh().catch((e) => setError(String(e)));
    });
    return () => {
      offShow.then((fn) => fn());
      offClipboard.then((fn) => fn());
    };
  }, [refresh]);

  // Auto-dismiss errors so a stale message doesn't sit forever.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(t);
  }, [error]);

  const backToPalette = () => {
    setInitialFilter(null);
    setView({ kind: "palette" });
  };

  async function onCommand(id: string) {
    switch (id) {
      case "create.snippet":
        setView({ kind: "create", presetKind: "snippet" });
        break;
      case "create.quicklink":
        setView({ kind: "create", presetKind: "quicklink" });
        break;
      case "open.preferences":
        try {
          await api.showPreferences();
          await api.hidePalette();
        } catch (e) {
          setError(String(e));
        }
        break;
      case "switch.workspace":
        setView({ kind: "workspace-switcher" });
        break;
      // Window management — these dispatch through Tauri so they all share
      // the same hide-palette + 60ms grace + osascript pattern.
      case "wm.left":
        api.wmLeftHalf().catch((e) => setError(String(e)));
        break;
      case "wm.right":
        api.wmRightHalf().catch((e) => setError(String(e)));
        break;
      case "wm.top":
        api.wmTopHalf().catch((e) => setError(String(e)));
        break;
      case "wm.bottom":
        api.wmBottomHalf().catch((e) => setError(String(e)));
        break;
      case "wm.maximize":
        api.wmMaximize().catch((e) => setError(String(e)));
        break;
      case "wm.center":
        api.wmCenter().catch((e) => setError(String(e)));
        break;
      // "Switch Theme" is handled inline by the Palette via kindFilter.
      // Nothing for App to do here.
    }
  }

  return (
    <>
      {view.kind === "create" && (
        <ItemForm
          presetKind={view.presetKind}
          onDone={async () => {
            await refresh();
            backToPalette();
          }}
          onCancel={backToPalette}
          onError={setError}
        />
      )}
      {view.kind === "edit" && (
        <ItemForm
          initial={view.item}
          onDone={async () => {
            await refresh();
            backToPalette();
          }}
          onCancel={backToPalette}
          onError={setError}
        />
      )}
      {view.kind === "palette" && (
        <Palette
          entries={entries}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace}
          settings={settings}
          session={session}
          initialFilter={initialFilter}
          onEdit={(item) => setView({ kind: "edit", item })}
          onCommand={onCommand}
          refresh={refresh}
          onError={setError}
        />
      )}
      {view.kind === "workspace-switcher" && (
        <>
          <Palette
            entries={entries}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspace}
            settings={settings}
            session={session}
            initialFilter={initialFilter}
            onEdit={(item) => setView({ kind: "edit", item })}
            onCommand={onCommand}
            refresh={refresh}
            onError={setError}
          />
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeId={activeWorkspace}
            onClose={backToPalette}
            onSwitched={refresh}
            onError={setError}
          />
        </>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-banner-text">{error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
