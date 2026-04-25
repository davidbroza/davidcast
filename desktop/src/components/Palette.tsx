import Fuse from "fuse.js";
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
  isFile,
  isQuicklink,
  isSnippet,
  isVite,
} from "../types";
import type { FileSearchOpts } from "../types";

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

/// Parse the file-mode query into structured search options.
///
/// Supported tokens:
///   :png / :jpg / :pdf / ...   -> filter by extension
///   :img | :image              -> any image extension shorthand
///   :newest                    -> sort by modified time, newest first
/// Anything else is treated as a name pattern handed to fd.
function parseFileQuery(input: string): FileSearchOpts {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const opts: FileSearchOpts = {};
  const remaining: string[] = [];
  const extensions: string[] = [];
  for (const t of tokens) {
    if (t.startsWith(":")) {
      const key = t.slice(1).toLowerCase();
      if (key === "newest") opts.sort_by_mtime = true;
      else if (key === "img" || key === "image") opts.category = "image";
      else if (/^[a-z0-9]+$/.test(key)) extensions.push(key);
    } else {
      remaining.push(t);
    }
  }
  if (extensions.length) opts.extensions = extensions;
  const q = remaining.join(" ");
  if (q) opts.query = q;
  // Empty query with no other filters = show 50 most recently modified
  // files so the file mode never opens to a blank screen.
  if (
    !q &&
    extensions.length === 0 &&
    !opts.category &&
    !opts.sort_by_mtime
  ) {
    opts.sort_by_mtime = true;
    opts.limit = 50;
  }
  return opts;
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
  const [fileEntries, setFileEntries] = useState<PaletteEntry[]>([]);
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

  // File search runs via the backend on every keystroke (debounced 200ms).
  // Empty query in file mode falls back to "newest 50" so the user sees
  // something useful immediately.
  useEffect(() => {
    if (kindFilter !== "file") return;
    const opts = parseFileQuery(query);
    let cancelled = false;
    const handle = window.setTimeout(() => {
      api
        .searchFiles(opts)
        .then((rows) => {
          if (cancelled) return;
          setFileEntries(rows.map((r) => ({ kind: "file" as const, ...r })));
        })
        .catch((e) => onError(String(e)));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, kindFilter, onError]);

  const visibleEntries = useMemo(() => {
    if (kindFilter === "clipboard") return clipboardEntries;
    if (kindFilter === "file") return fileEntries;
    if (kindFilter) return entries.filter((e) => e.kind === kindFilter);
    // Unfiltered view: respect inline-display settings. Vite/Docker entries
    // are still reachable via "Show Vite Ports" / "Show Docker Containers"
    // commands, which set a kindFilter and bypass this rule.
    return entries.filter((e) => {
      if (e.kind === "vite" && !settings.show_vite_inline) return false;
      if (e.kind === "docker" && !settings.show_docker_inline) return false;
      return true;
    });
  }, [entries, clipboardEntries, fileEntries, kindFilter, settings]);

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
    // File mode is fully resolved by the backend (fd does the matching);
    // skip Fuse entirely so we don't filter the results twice.
    if (kindFilter === "file") return visibleEntries;
    const q = query.trim();
    if (!q) {
      // Empty query order:
      //   1) recents — what you actually use, newest first
      //   2) kind priority — apps > your items > plugins > clipboard
      //   3) alphabetical name — predictable tiebreaker
      const recents = loadRecents();
      const ranked = [...visibleEntries];
      ranked.sort((a, b) => {
        const ra = recents[entryKey(a)] ?? 0;
        const rb = recents[entryKey(b)] ?? 0;
        if (ra !== rb) return rb - ra;
        const pa = kindPriority(a);
        const pb = kindPriority(b);
        if (pa !== pb) return pa - pb;
        return nameOf(a).localeCompare(nameOf(b));
      });
      return ranked;
    }
    const results = fuse.search(q);
    // Adjust Fuse's raw match score with two boosts:
    //   - prefix bonus: strong (-0.4) — typing "i" should land on iTerm,
    //     not on something that fuzzy-contains an i three chars deep.
    //   - recents bonus: gentler (-0.18) — what you actually use beats
    //     equally-good matches you've never picked.
    // Lower effective score = better, same as Fuse.
    const recents = loadRecents();
    const ql = q.toLowerCase();
    const scored = results.map((r) => {
      const item = r.item;
      let score = r.score ?? 1;
      const startsName = nameOf(item).toLowerCase().startsWith(ql);
      const kw = (item as { keyword?: string }).keyword;
      const startsKeyword = kw ? kw.toLowerCase().startsWith(ql) : false;
      if (startsName || startsKeyword) score -= 0.4;
      if (recents[entryKey(item)]) score -= 0.18;
      return { item, score };
    });
    scored.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.02) return a.score - b.score;
      const pa = kindPriority(a.item);
      const pb = kindPriority(b.item);
      if (pa !== pb) return pa - pb;
      return nameOf(a.item).localeCompare(nameOf(b.item));
    });
    return scored.map((r) => r.item);
  }, [query, fuse, visibleEntries, kindFilter]);

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

  // Refocus the input every time the palette window regains focus. The
  // component stays mounted across hide/show cycles, so the mount-only
  // focus above isn't enough — without this you'd have to click the input
  // before typing on the second open.
  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Clear state when the palette window loses focus (i.e. *before* the next
  // open). Doing this on `palette:show` would flash the old text for a frame;
  // doing it on blur means the next open paints blank from the start.
  //
  // Always reset to the full palette — `initialFilter` is the *intent* of
  // the most recent open (e.g. ⌘⇧V wants clipboard mode), but the next open
  // will set it again via App's `palette:show` listener if it cares. Without
  // this, a stale filter from a previous session lingers and your most-used
  // items vanish until you hit Escape.
  useEffect(() => {
    const onBlur = () => {
      setQuery("");
      setSelected(0);
      setKindFilter(null);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

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
          case "files.find":
            setQuery("");
            setKindFilter("file");
            break;
          case "files.screenshots":
            setQuery(":img :newest screenshot");
            setKindFilter("file");
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
      } else if (isFile(entry)) {
        if (entry.is_image) {
          await api.copyFileImage(entry.path);
          setToast("Image copied to clipboard");
          window.setTimeout(() => setToast(null), 1100);
        } else {
          await api.openFile(entry.path);
        }
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
      if (!entry) return;
      // ⌘↵ on a file forces "open" even for images (whose default action
      // would otherwise copy the bitmap to the clipboard).
      if (cmd && isFile(entry)) {
        api
          .openFile(entry.path)
          .catch((err) => onError(String(err)));
        return;
      }
      execute(entry);
      return;
    }

    // File-row shortcuts: copy path / reveal in Finder.
    const fileEntry = (() => {
      const entry = filtered[selected];
      return entry && isFile(entry) ? entry : null;
    })();
    if (cmd && fileEntry && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      api
        .copyFilePath(fileEntry.path)
        .then(() => {
          setToast("Path copied");
          window.setTimeout(() => setToast(null), 700);
        })
        .catch((err) => onError(String(err)));
      return;
    }
    if (cmd && fileEntry && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      api.revealFile(fileEntry.path).catch((err) => onError(String(err)));
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
  if (isFile(e)) return `file:${e.path}`;
  if (isClipboard(e)) return `clip:${e.id}`;
  return `${e.kind}:${e.id}`;
}

function kindPriority(e: PaletteEntry): number {
  // Order chosen so the things you type and pick most often surface first.
  // Apps are by far the most-used kind ("iterm", "chrome"…), then your
  // own quicklinks/snippets, then the live system plugins.
  switch (e.kind) {
    case "command":
      return 0;
    case "app":
      return 1;
    case "quicklink":
      return 2;
    case "snippet":
      return 3;
    case "agent":
      return 4;
    case "vite":
      return 5;
    case "docker":
      return 6;
    case "file":
      return 7;
    case "clipboard":
      return 8;
  }
}

function nameOf(e: PaletteEntry): string {
  if (e.kind === "agent") return e.project;
  if (e.kind === "vite") return e.project;
  if (e.kind === "docker") return e.name;
  if (e.kind === "file") return e.name;
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
    case "file":
      return "Files";
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
    case "file":
      return "Find files — try :png screenshot, :img :newest, ⌘C path, ⌘R reveal";
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
  } else if (isFile(entry)) {
    name = entry.name;
    sub = `${entry.parent} · ${formatSize(entry.size)} · ${relativeTime(
      new Date(entry.modified_at).toISOString()
    )}`;
    badge = entry.is_image
      ? "Image"
      : entry.ext
      ? entry.ext.toUpperCase()
      : "File";
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
  if (isFile(entry)) {
    if (entry.is_image) {
      return <ImageThumb path={entry.path} fallback={entry.name} />;
    }
    return (
      <div className="row-icon glyph file">
        <FileGlyph />
      </div>
    );
  }
  return <div className="row-icon glyph" />;
}

// Lazy thumbnail loader for image files. Mirrors the AppIcon cache so we
// only round-trip to Rust once per path; failures stick (no infinite retry).
const THUMB_CACHE = new Map<string, string | null>();

function ImageThumb({ path, fallback }: { path: string; fallback: string }) {
  const [src, setSrc] = useState<string | null>(() => THUMB_CACHE.get(path) ?? null);
  const [tried, setTried] = useState(THUMB_CACHE.has(path));

  useEffect(() => {
    if (tried) return;
    let cancelled = false;
    api
      .fileThumbnail(path)
      .then((url) => {
        if (cancelled) return;
        THUMB_CACHE.set(path, url);
        setSrc(url);
        setTried(true);
      })
      .catch(() => {
        if (cancelled) return;
        THUMB_CACHE.set(path, null);
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
function FileGlyph() {
  // Sheet of paper with a folded corner.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3.5 2.5 L9 2.5 L12.5 6 L12.5 13.5 L3.5 13.5 Z M9 2.5 L9 6 L12.5 6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
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
