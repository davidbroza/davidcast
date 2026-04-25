import Fuse from "fuse.js";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Settings } from "../api";
import type { Session } from "../App";
import type { Item, PaletteEntry, Workspace } from "../types";
import {
  asItem,
  extractPlaceholders,
  isAgent,
  isApp,
  isClipboard,
  isCommand,
  isDocker,
  isQuicklink,
  isSnippet,
  isVite,
} from "../types";

type KindFilter = PaletteEntry["kind"] | null;

// Recents — the last few items the user actually picked, persisted to
// localStorage so they survive across launches. Drives the empty-query
// suggestion list.
const RECENTS_KEY = "davidcast.recents";
const MAX_RECENTS = 24;

function loadRecents(): Record<string, number> {
  try {
    const v = localStorage.getItem(RECENTS_KEY);
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}

function touchRecent(key: string) {
  const map = loadRecents();
  map[key] = Date.now();
  // Keep only the most recent MAX_RECENTS so this never grows unbounded.
  const trimmed = Object.fromEntries(
    Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_RECENTS)
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota — ignore */
  }
}

type Props = {
  entries: PaletteEntry[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  settings: Settings;
  session: Session;
  initialFilter?: KindFilter;
  onEdit: (item: Item) => void;
  onCommand: (id: string) => void;
  refresh: () => Promise<void>;
  onError: (msg: string) => void;
};

export function Palette({
  entries,
  workspaces,
  activeWorkspaceId,
  settings,
  session,
  initialFilter,
  onEdit,
  onCommand,
  refresh,
  onError,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>(initialFilter ?? null);
  const [clipboardEntries, setClipboardEntries] = useState<PaletteEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const deleteTimer = useRef<number | null>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  // React to App-driven filter changes (e.g. ⌘⇧V opens straight into clipboard).
  useEffect(() => {
    if (initialFilter !== undefined) setKindFilter(initialFilter);
  }, [initialFilter]);

  // Clipboard entries live outside the regular palette list — fetched on demand.
  useEffect(() => {
    if (kindFilter !== "clipboard") return;
    let cancelled = false;
    api
      .listClipboard()
      .then((rows) => {
        if (cancelled) return;
        setClipboardEntries(
          rows.map((r) => ({ kind: "clipboard" as const, ...r }))
        );
      })
      .catch((e) => onError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [kindFilter, onError]);

  const visibleEntries = useMemo(() => {
    if (kindFilter === "clipboard") return clipboardEntries;
    if (kindFilter) return entries.filter((e) => e.kind === kindFilter);
    // Unfiltered view: respect inline-display settings. Vite/Docker entries
    // are still reachable via "Show Vite Ports" / "Show Docker Containers"
    // commands, which set a kindFilter and bypass this rule.
    return entries.filter((e) => {
      if (e.kind === "vite" && !settings.show_vite_inline) return false;
      if (e.kind === "docker" && !settings.show_docker_inline) return false;
      return true;
    });
  }, [entries, clipboardEntries, kindFilter, settings]);

  const fuse = useMemo(
    () =>
      new Fuse(visibleEntries, {
        keys: [
          { name: "keyword", weight: 3 },
          { name: "name", weight: 2 },
          { name: "project", weight: 2 },
          { name: "image", weight: 1 },
          { name: "mode", weight: 1.5 },
          { name: "subtitle", weight: 0.8 },
          { name: "url", weight: 0.4 },
          { name: "text", weight: 0.3 },
          { name: "path", weight: 0.2 },
          { name: "cwd", weight: 0.2 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        includeScore: true,
        minMatchCharLength: 1,
      }),
    [visibleEntries]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // Empty query: float recently-used items to the top, newest first,
      // then keep the rest in their original (kind-priority) order.
      const recents = loadRecents();
      const ranked = [...visibleEntries];
      ranked.sort((a, b) => {
        const ra = recents[entryKey(a)] ?? 0;
        const rb = recents[entryKey(b)] ?? 0;
        if (ra !== rb) return rb - ra;
        return 0;
      });
      return ranked;
    }
    const results = fuse.search(q);
    results.sort((a, b) => {
      const sa = a.score ?? 1;
      const sb = b.score ?? 1;
      if (Math.abs(sa - sb) > 0.02) return sa - sb;
      const pa = kindPriority(a.item);
      const pb = kindPriority(b.item);
      if (pa !== pb) return pa - pb;
      return nameOf(a.item).localeCompare(nameOf(b.item));
    });
    return results.map((r) => r.item);
  }, [query, fuse, visibleEntries]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    setSelected((s) => {
      const max = Math.max(0, filtered.length - 1);
      return Math.min(s, max);
    });
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // When the palette is reopened (Alt+Space toggle), wipe the previous query
  // and any active filter so the user starts on a clean slate.
  useEffect(() => {
    const off = listen("palette:show", () => {
      setQuery("");
      setSelected(0);
      setKindFilter(initialFilter ?? null);
    });
    return () => {
      off.then((fn) => fn());
    };
  }, [initialFilter]);

  // No-results detection: when the user has typed something but nothing
  // matched, debounce 600ms and log it once. Reset whenever query changes.
  const noResultsLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0 || filtered.length > 0) {
      noResultsLoggedRef.current = null;
      return;
    }
    if (noResultsLoggedRef.current === q) return;
    const handle = window.setTimeout(() => {
      if (noResultsLoggedRef.current === q) return;
      noResultsLoggedRef.current = q;
      api
        .analyticsRecord(session.id, "no_results", {
          q,
          dwell_ms: Date.now() - session.startedAt,
          kind_filter: kindFilter,
        })
        .catch(() => {});
    }, 600);
    return () => window.clearTimeout(handle);
  }, [query, filtered.length, session, kindFilter]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLDivElement>(".row.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  async function execute(entry: PaletteEntry) {
    const startedAt = Date.now();
    const queryAtExecute = query;
    const resultCount = filtered.length;
    let outcome: "filter" | "executed" | "cancelled" = "executed";
    let success = true;
    let error: string | undefined;

    try {
      if (isCommand(entry)) {
        // Filter-only commands set the kindFilter and stop here. They aren't
        // really "executions" of an item, so we log them as outcome="filter".
        outcome = "filter";
        switch (entry.id) {
          case "show.agents":
            setQuery("");
            setKindFilter("agent");
            break;
          case "show.vite":
            setQuery("");
            setKindFilter("vite");
            break;
          case "show.docker":
            setQuery("");
            setKindFilter("docker");
            break;
          case "search.snippets":
            setQuery("");
            setKindFilter("snippet");
            break;
          case "search.quicklinks":
            setQuery("");
            setKindFilter("quicklink");
            break;
          case "show.clipboard":
            setQuery("");
            setKindFilter("clipboard");
            break;
          default:
            // Non-filter commands ("Create Snippet", "Open Preferences", …)
            // bubble up to App; mark as a real execution.
            outcome = "executed";
            onCommand(entry.id);
        }
      } else if (isApp(entry)) {
        await api.executeApp(entry.path);
      } else if (isAgent(entry)) {
        await api.executeAgent({
          pid: entry.pid,
          tty: entry.tty,
          terminal_app: entry.terminal_app,
        });
      } else if (isVite(entry)) {
        await api.executeVite(entry.url);
      } else if (isDocker(entry)) {
        if (entry.mode === "logs") {
          await api.executeDockerLogs(entry.id);
        } else {
          await api.executeDockerShell(entry.id);
        }
      } else if (isSnippet(entry)) {
        await api.executeSnippet(entry.id);
        setToast("Copied to clipboard");
        window.setTimeout(() => {
          setToast(null);
          api.hideAndPaste().catch(() => {});
        }, 1100);
      } else if (isQuicklink(entry)) {
        const placeholders = extractPlaceholders(entry.url);
        const args: Record<string, string> = {};
        for (const p of placeholders) {
          const v = window.prompt(`${p}?`, "");
          if (v === null) {
            outcome = "cancelled";
            break;
          }
          args[p] = v;
        }
        if (outcome !== "cancelled") {
          await api.executeQuicklink(entry.id, args);
        }
      } else if (isClipboard(entry)) {
        await api.executeClipboard(entry.id);
        setToast("Pasted from history");
        window.setTimeout(() => setToast(null), 800);
      }
    } catch (e) {
      success = false;
      error = String(e);
      onError(error);
    }

    // Fire-and-forget local analytics — never await, never throw.
    api
      .analyticsRecord(session.id, "execute", {
        kind: entry.kind,
        name: shortName(entry),
        outcome,
        success,
        error,
        duration_ms: Date.now() - startedAt,
        q: queryAtExecute,
        result_count: resultCount,
        dwell_ms: Date.now() - session.startedAt,
        kind_filter: kindFilter,
      })
      .catch(() => {});

    // Bump recents on successful real executions only — we don't want
    // "Create Snippet" or filter chips to dominate the suggestion list.
    if (
      success &&
      outcome === "executed" &&
      !isCommand(entry) &&
      !isClipboard(entry)
    ) {
      touchRecent(entryKey(entry));
    }
  }

  async function handleKey(e: React.KeyboardEvent) {
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    const cmd = e.metaKey;

    if (
      e.key === "ArrowDown" ||
      (ctrlOnly && (e.key === "n" || e.key === "j"))
    ) {
      e.preventDefault();
      setSelected((s) => Math.min(filtered.length - 1, s + 1));
      return;
    }
    if (e.key === "ArrowUp" || (ctrlOnly && (e.key === "p" || e.key === "k"))) {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[selected];
      if (entry) execute(entry);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (pendingDelete) {
        setPendingDelete(null);
        return;
      }
      if (kindFilter) {
        setKindFilter(null);
        return;
      }
      api.hidePalette();
      return;
    }

    if (ctrlOnly && e.key === "u") {
      e.preventDefault();
      setQuery("");
      return;
    }
    if (ctrlOnly && e.key === "a") {
      e.preventDefault();
      inputRef.current?.setSelectionRange(0, 0);
      return;
    }
    if (ctrlOnly && e.key === "e") {
      e.preventDefault();
      const l = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(l, l);
      return;
    }

    if (cmd && e.key === "n") {
      e.preventDefault();
      onCommand("create.snippet");
      return;
    }
    if (cmd && e.key === "k") {
      e.preventDefault();
      onCommand("switch.workspace");
      return;
    }
    if (cmd && e.key === ",") {
      e.preventDefault();
      onCommand("open.preferences");
      return;
    }
    if (cmd && e.key === "e") {
      e.preventDefault();
      const entry = filtered[selected];
      const item = entry && asItem(entry);
      if (item) onEdit(item);
      return;
    }
    if (cmd && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      const entry = filtered[selected];
      // Clipboard entries get their own delete path (not the snippet/quicklink one).
      if (entry && isClipboard(entry)) {
        await api.deleteClipboardEntry(entry.id).catch((err) => onError(String(err)));
        const rows = await api.listClipboard();
        setClipboardEntries(
          rows.map((r) => ({ kind: "clipboard" as const, ...r }))
        );
        return;
      }
      const item = entry && asItem(entry);
      if (!item) return;
      await requestDelete(item);
      return;
    }
  }

  async function requestDelete(item: Item) {
    if (pendingDelete && pendingDelete.id === item.id) {
      if (deleteTimer.current) window.clearTimeout(deleteTimer.current);
      setPendingDelete(null);
      try {
        if (item.kind === "snippet") await api.deleteSnippet(item.id);
        else await api.deleteQuicklink(item.id);
        await refresh();
      } catch (e) {
        onError(String(e));
      }
      return;
    }
    setPendingDelete(item);
    if (deleteTimer.current) window.clearTimeout(deleteTimer.current);
    deleteTimer.current = window.setTimeout(() => {
      setPendingDelete((prev) => (prev?.id === item.id ? null : prev));
    }, 4000);
  }

  return (
    <div className="palette" onKeyDown={handleKey}>
      <div className="topbar">
        <div
          className="workspace-pill"
          onClick={() => onCommand("switch.workspace")}
          title="Switch workspace (⌘K)"
        >
          <span
            className="workspace-dot"
            style={active?.color ? { background: active.color } : undefined}
          />
          {active?.name ?? activeWorkspaceId}
        </div>
        <div className="topbar-spacer" />
        <span className="topbar-hint">davidcast</span>
      </div>

      <div className="search">
        {kindFilter && (
          <div className="filter-chip" onClick={() => setKindFilter(null)}>
            {filterLabel(kindFilter)} <span className="close">✕</span>
          </div>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholderFor(kindFilter)}
          autoFocus
          spellCheck={false}
        />
      </div>

      <div className="results" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="empty">
            <h3>{kindFilter === "clipboard" ? "Clipboard is empty" : "No matches"}</h3>
            <p>
              {kindFilter === "clipboard"
                ? "Copy something — it'll show up here."
                : <>Try a different search or <kbd>⌘N</kbd> to create a new item.</>}
            </p>
          </div>
        ) : (
          filtered.map((entry, i) => (
            <Row
              key={entryKey(entry)}
              entry={entry}
              selected={i === selected}
              onHover={() => setSelected(i)}
              onClick={() => execute(entry)}
            />
          ))
        )}
      </div>

      <div className="footer">
        <span><kbd>↵</kbd>Run</span>
        <span><kbd>⌃N</kbd>/<kbd>⌃P</kbd>Nav</span>
        <span><kbd>⌘N</kbd>New</span>
        <span><kbd>⌘E</kbd>Edit</span>
        <span><kbd>⌘⌫</kbd>Delete</span>
        <div className="footer-spacer" />
        <span><kbd>⌘⇧V</kbd>Clipboard</span>
        <span><kbd>⌘K</kbd>Workspace</span>
        <span><kbd>esc</kbd>Close</span>
      </div>

      {toast && <div className="toast">✓ {toast}</div>}
      {pendingDelete && (
        <div className="confirm-banner">
          Delete <b>{pendingDelete.name}</b>? Press <kbd>⌘⌫</kbd> again to
          confirm, <kbd>esc</kbd> to cancel.
        </div>
      )}
    </div>
  );
}

function entryKey(e: PaletteEntry): string {
  if (isCommand(e)) return `cmd:${e.id}`;
  if (isApp(e)) return `app:${e.path}`;
  if (isAgent(e)) return `agent:${e.pid}`;
  if (isVite(e)) return `vite:${e.pid}:${e.port}`;
  if (isDocker(e)) return `docker:${e.id}:${e.mode}`;
  if (isClipboard(e)) return `clip:${e.id}`;
  return `${e.kind}:${e.id}`;
}

function kindPriority(e: PaletteEntry): number {
  switch (e.kind) {
    case "command":
      return 0;
    case "agent":
      return 1;
    case "vite":
      return 2;
    case "docker":
      return 3;
    case "snippet":
      return 4;
    case "quicklink":
      return 5;
    case "clipboard":
      return 6;
    case "app":
      return 7;
  }
}

function nameOf(e: PaletteEntry): string {
  if (e.kind === "agent") return e.project;
  if (e.kind === "vite") return e.project;
  if (e.kind === "docker") return e.name;
  if (e.kind === "clipboard") return e.text;
  return (e as { name?: string }).name ?? "";
}

/// Short label used in analytics. Strips long bodies (clipboard text) so
/// the JSONL stays grep-friendly.
function shortName(e: PaletteEntry): string {
  const n = nameOf(e);
  return n.length > 80 ? n.slice(0, 77) + "…" : n;
}

/// Render the git context for a row's subtitle: ` · main` or ` · main*`
/// for a dirty tree, empty string for non-repos. Detached HEAD shows up
/// with no branch name, so we skip it.
function gitFragment(g: import("../types").GitInfo | undefined): string {
  if (!g || !g.is_repo || !g.branch) return "";
  return ` · ${g.branch}${g.dirty ? "*" : ""}`;
}

function filterLabel(k: PaletteEntry["kind"]): string {
  switch (k) {
    case "agent":
      return "Agents";
    case "vite":
      return "Vite ports";
    case "docker":
      return "Docker";
    case "snippet":
      return "Snippets";
    case "quicklink":
      return "Quicklinks";
    case "app":
      return "Apps";
    case "command":
      return "Commands";
    case "clipboard":
      return "Clipboard";
  }
}

function placeholderFor(k: KindFilter): string {
  switch (k) {
    case "agent":
      return "Search running agents by project…";
    case "vite":
      return "Search Vite dev servers — ↵ opens in browser";
    case "docker":
      return "Search Docker containers — ↵ shell, or type 'logs'";
    case "snippet":
      return "Search snippets…";
    case "quicklink":
      return "Search quicklinks…";
    case "clipboard":
      return "Search clipboard history…";
    case "app":
      return "Search applications…";
    case "command":
      return "Search built-in commands…";
    default:
      return "Type to search — snippets, quicklinks, apps, agents, commands…";
  }
}

// ---------- Row ----------

function Row({
  entry,
  selected,
  onHover,
  onClick,
}: {
  entry: PaletteEntry;
  selected: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  let name = "";
  let sub = "";
  let badge = "";

  if (isCommand(entry)) {
    name = entry.name;
    sub = entry.subtitle;
    badge = "Command";
  } else if (isApp(entry)) {
    name = entry.name;
    sub = entry.path;
    badge = "App";
  } else if (isSnippet(entry)) {
    name = entry.name;
    sub = oneLine(entry.text);
    badge = "Snippet";
  } else if (isQuicklink(entry)) {
    name = entry.name;
    sub = entry.url;
    badge = "Quicklink";
  } else if (isAgent(entry)) {
    name = entry.project || "unknown project";
    sub = `${entry.cwd}${gitFragment(entry.git)} · ${entry.terminal_app} · ${entry.elapsed}`;
    badge = "Agent";
  } else if (isVite(entry)) {
    name = `${entry.project} · :${entry.port}`;
    sub = `${entry.url}${gitFragment(entry.git)} · ${entry.cwd} · ${entry.elapsed}`;
    badge = "Vite";
  } else if (isDocker(entry)) {
    name =
      entry.mode === "logs"
        ? `${entry.name} · logs`
        : `${entry.name} · shell`;
    sub = `${entry.image} · ${entry.status}${
      entry.ports ? ` · ${entry.ports}` : ""
    }`;
    badge = entry.mode === "logs" ? "Logs" : "Docker";
  } else if (isClipboard(entry)) {
    name = oneLine(entry.text) || "(empty)";
    sub = `${entry.char_count} chars · ${relativeTime(entry.copied_at)}`;
    badge = "Clipboard";
  }

  const keyword =
    (isSnippet(entry) || isQuicklink(entry)) && entry.keyword
      ? entry.keyword
      : null;

  return (
    <div
      className={`row ${selected ? "active" : ""}`}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      <EntryIcon entry={entry} />
      <div className="row-main">
        <div className="row-name">{name}</div>
        <div className="row-sub">{sub}</div>
      </div>
      <div className="row-right">
        {keyword && <span className="keyword">{keyword}</span>}
        <span className="kind-badge">{badge}</span>
      </div>
    </div>
  );
}

function EntryIcon({ entry }: { entry: PaletteEntry }) {
  if (isApp(entry)) return <AppIcon path={entry.path} fallback={entry.name} />;

  if (isCommand(entry)) {
    return (
      <div className="row-icon glyph command">
        <CommandGlyph />
      </div>
    );
  }
  if (isSnippet(entry)) {
    return (
      <div className="row-icon glyph snippet">
        <SnippetGlyph />
      </div>
    );
  }
  if (isQuicklink(entry)) {
    return (
      <div className="row-icon glyph quicklink">
        <QuicklinkGlyph />
      </div>
    );
  }
  if (isAgent(entry)) {
    return (
      <div className="row-icon glyph agent">
        <AgentGlyph />
      </div>
    );
  }
  if (isVite(entry)) {
    return (
      <div className="row-icon glyph vite">
        <ViteGlyph />
      </div>
    );
  }
  if (isDocker(entry)) {
    return (
      <div
        className={`row-icon glyph docker${
          entry.mode === "logs" ? " logs" : ""
        }`}
      >
        {entry.mode === "logs" ? <LogsGlyph /> : <DockerGlyph />}
      </div>
    );
  }
  if (isClipboard(entry)) {
    return (
      <div className="row-icon glyph clipboard">
        <ClipboardGlyph />
      </div>
    );
  }
  return <div className="row-icon glyph" />;
}

// In-memory cache so re-renders don't re-fetch — and so failures don't retry forever.
const ICON_CACHE = new Map<string, string | null>();

function AppIcon({ path, fallback }: { path: string; fallback: string }) {
  const [src, setSrc] = useState<string | null>(() => ICON_CACHE.get(path) ?? null);
  const [tried, setTried] = useState(ICON_CACHE.has(path));

  useEffect(() => {
    if (tried) return;
    let cancelled = false;
    api
      .getAppIcon(path)
      .then((url) => {
        if (cancelled) return;
        ICON_CACHE.set(path, url);
        setSrc(url);
        setTried(true);
      })
      .catch(() => {
        if (cancelled) return;
        ICON_CACHE.set(path, null);
        setTried(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tried]);

  if (src) {
    return (
      <div className="row-icon app-icon">
        <img src={src} alt="" draggable={false} />
      </div>
    );
  }
  return (
    <div className="row-icon app app-fallback">
      {fallback.charAt(0).toUpperCase()}
    </div>
  );
}

// ---------- Inline glyphs (so they crispen at any DPI) ----------

function CommandGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M5 1 L9 1 L8 7 L13 7 L7 15 L8 9 L3 9 Z"
        fill="currentColor"
      />
    </svg>
  );
}
function SnippetGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 4 H13 M3 8 H10 M3 12 H12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
function QuicklinkGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M6.5 9.5 L9.5 6.5 M5 11 a2.5 2.5 0 0 1 0-3.5 L6.5 6 a2.5 2.5 0 0 1 3.5 3.5 M11 5 a2.5 2.5 0 0 1 0 3.5 L9.5 10 a2.5 2.5 0 0 1-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
function AgentGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5 3 L12 8 L5 13 Z" fill="currentColor" />
    </svg>
  );
}
function ViteGlyph() {
  // A lightning-bolt-ish wedge — Vite's energy without the trademark.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M9 1 L3 9 L7 9 L6 15 L13 6 L9 6 Z"
        fill="currentColor"
      />
    </svg>
  );
}
function DockerGlyph() {
  // Stacked containers seen end-on.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2" y="9" width="2.4" height="2.4" fill="currentColor" />
      <rect x="5" y="9" width="2.4" height="2.4" fill="currentColor" />
      <rect x="8" y="9" width="2.4" height="2.4" fill="currentColor" />
      <rect x="5" y="6" width="2.4" height="2.4" fill="currentColor" />
      <rect x="8" y="6" width="2.4" height="2.4" fill="currentColor" />
      <rect x="8" y="3" width="2.4" height="2.4" fill="currentColor" />
      <path
        d="M1 12 q1.5 1.5 4 1.5 h6 q3 0 4-3"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
function LogsGlyph() {
  // Three log lines, descending widths.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 4 H13 M3 8 H11 M3 12 H9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
function ClipboardGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect
        x="3.5" y="3" width="9" height="11" rx="1.5"
        stroke="currentColor" strokeWidth="1.3" fill="none"
      />
      <rect
        x="6" y="1.8" width="4" height="2.4" rx="0.6"
        fill="currentColor"
      />
    </svg>
  );
}

function oneLine(t: string): string {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
