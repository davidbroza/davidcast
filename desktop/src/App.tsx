import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Settings } from "./api";
import type { Update } from "@tauri-apps/plugin-updater";
import { r2, scheduleIdle } from "./utils";
import { Analytics } from "./components/Analytics";
import { Help } from "./components/Help";
import { ItemForm } from "./components/ItemForm";
import { Palette } from "./components/Palette";
import { Preferences } from "./components/Preferences";
import { UpdateBanner } from "./components/UpdateBanner";
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
  | { kind: "workspace-switcher" }
  | { kind: "preferences" }
  | { kind: "help" }
  | { kind: "analytics" };

type InitialFilter = PaletteEntry["kind"] | null;

export default function App() {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>("");
  const [settings, setSettings] = useState<Settings>({
    show_vite_inline: true,
    show_docker_inline: true,
    show_snippets_inline: true,
    show_quicklinks_inline: true,
    screenshot_dirs: [],
    check_updates_on_launch: true,
  });
  const [update, setUpdate] = useState<Update | null>(null);
  const [view, setView] = useState<View>({ kind: "palette" });
  const [error, setError] = useState<string | null>(null);
  const [initialFilter, setInitialFilter] = useState<InitialFilter>(null);
  const [session, setSession] = useState<Session>(() => newSession());

  // Cheap content fingerprint of the last `entries` list. We re-fetch on
  // every palette open so dynamic kinds (agents, vite, docker, clipboard)
  // stay fresh — but if the resulting list is content-equal to what we
  // already have, we keep the old array reference. That stops the Fuse
  // index from rebuilding on every back-to-back ⌃Space, which was the
  // main source of first-keystroke latency.
  const entriesFingerprintRef = useRef<string>("");

  // Tracks the most recent refresh outcome so the open-perf event can
  // include whether refresh changed anything (cache hit vs miss).
  const lastRefreshChangedRef = useRef<boolean>(false);
  const lastRefreshMsRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    const t0 = performance.now();
    const [ws, list, s] = await Promise.all([
      api.listWorkspaces(),
      api.listPalette(),
      api.getSettings(),
    ]);
    setWorkspaces(ws.workspaces);
    setActiveWorkspace(ws.active);
    const fp = JSON.stringify(list);
    const changed = fp !== entriesFingerprintRef.current;
    if (changed) {
      entriesFingerprintRef.current = fp;
      setEntries(list);
    }
    setSettings(s);
    lastRefreshChangedRef.current = changed;
    lastRefreshMsRef.current = performance.now() - t0;
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  // Pull and apply the active theme on mount. Failures fall back to the
  // CSS defaults baked into palette.css.
  useEffect(() => {
    api.getActiveTheme().then(applyTheme).catch(() => {});
  }, []);

  // Check for updates on launch, gated by user setting. Silent when no
  // update or when the network is offline — manual "Check for Updates"
  // command surfaces errors.
  useEffect(() => {
    if (!settings.check_updates_on_launch) return;
    let cancelled = false;
    api
      .checkForUpdate()
      .then((u) => {
        if (cancelled || !u) return;
        setUpdate(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settings.check_updates_on_launch]);

  const checkForUpdateNow = useCallback(async () => {
    try {
      const u = await api.checkForUpdate();
      if (u) {
        setUpdate(u);
      } else {
        setError(`You're up to date (v${import.meta.env.VITE_APP_VERSION ?? ""}).`);
      }
    } catch (e) {
      setError(`Update check failed: ${e}`);
    }
  }, []);

  // Stamped when the palette is dismissed (blur). Used to compute
  // idle_ms_since_last_use on the next open — that's the signal we
  // need to spot macOS App Nap waking the process up.
  const lastDismissAtRef = useRef<number | null>(null);

  const measureOpen = useCallback(
    (sessionId: string, via: string) => {
      const showStartedAt = performance.now();
      const idleMs =
        lastDismissAtRef.current != null
          ? showStartedAt - lastDismissAtRef.current
          : null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const paintMs = performance.now() - showStartedAt;
          scheduleIdle(() => {
            api
              .analyticsRecord(sessionId, "perf_open", {
                via,
                paint_ms: r2(paintMs),
                idle_ms_since_last_use: idleMs == null ? null : r2(idleMs),
                refresh_changed: lastRefreshChangedRef.current,
                refresh_ms: r2(lastRefreshMsRef.current),
              })
              .catch(() => {});
          });
        });
      });
    },
    []
  );

  useEffect(() => {
    const offShow = listen("palette:show", () => {
      setView({ kind: "palette" });
      setError(null);
      setInitialFilter(null);
      const s = newSession();
      setSession(s);
      api.analyticsRecord(s.id, "open", { via: "hotkey" }).catch(() => {});
      measureOpen(s.id, "hotkey");
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
      measureOpen(s.id, "clipboard_hotkey");
      refresh().catch((e) => setError(String(e)));
    });
    // The tray menu's "Preferences…" item routes through the backend so
    // it can show the main window first; then it fires this event to
    // switch the view inside.
    const offPrefs = listen("preferences:show", () => {
      setView({ kind: "preferences" });
      setError(null);
      setInitialFilter(null);
      refresh().catch((e) => setError(String(e)));
    });
    // Stamp the moment the window loses focus so the *next* open can
    // report idle_ms_since_last_use. Cheap; just a timestamp.
    const onBlurStamp = () => {
      lastDismissAtRef.current = performance.now();
    };
    window.addEventListener("blur", onBlurStamp);
    return () => {
      offShow.then((fn) => fn());
      offClipboard.then((fn) => fn());
      offPrefs.then((fn) => fn());
      window.removeEventListener("blur", onBlurStamp);
    };
  }, [refresh, measureOpen]);

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
        setView({ kind: "preferences" });
        break;
      case "help.show":
        setView({ kind: "help" });
        break;
      case "show.analytics":
        setView({ kind: "analytics" });
        break;
      case "app.check_updates":
        checkForUpdateNow();
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
      {view.kind === "preferences" && (
        <Preferences onClose={backToPalette} onError={setError} />
      )}
      {view.kind === "help" && <Help onClose={backToPalette} />}
      {view.kind === "analytics" && (
        <Analytics onClose={backToPalette} onError={setError} />
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
      {update && (
        <UpdateBanner
          update={update}
          onDismiss={() => setUpdate(null)}
          onError={setError}
        />
      )}
    </>
  );
}
