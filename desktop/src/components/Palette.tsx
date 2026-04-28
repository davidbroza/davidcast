import Fuse from "fuse.js";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  isSkill,
  isSnippet,
  isTheme,
  isVite,
} from "../types";
import type { FileSearchOpts } from "../types";
import { applyTheme } from "../App";

type KindFilter = PaletteEntry["kind"] | null;

// Recents — the last few items the user actually picked, persisted to
// localStorage so they survive across launches. Drives the empty-query
// suggestion list.
const RECENTS_KEY = "davidcast.recents";
const MAX_RECENTS = 24;

// Hard cap on rows handed to the renderer. Past ~80 you can't see them
// anyway, and React reconciling 300+ rows with SVG glyphs + AppIcon
// effects on every keystroke is a measurable hit on first-letter latency.
const MAX_VISIBLE = 80;

// Tighter cap for the empty-query view — the user sees this *before* the
// first keystroke, so painting 80 rows just to immediately diff most of
// them away is wasted work. 24 covers all visible rows + a buffer.
const MAX_VISIBLE_EMPTY = 24;

const FUSE_OPTIONS: import("fuse.js").IFuseOptions<PaletteEntry> = {
  keys: [
    { name: "keyword", weight: 3 },
    { name: "name", weight: 2 },
    { name: "project", weight: 2 },
    { name: "image", weight: 1 },
    { name: "mode", weight: 1.5 },
    { name: "subtitle", weight: 0.8 },
    { name: "description", weight: 0.5 },
    { name: "url", weight: 0.4 },
    { name: "text", weight: 0.3 },
    { name: "path", weight: 0.2 },
    { name: "cwd", weight: 0.2 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 1,
};

// Module-level cache so we don't JSON.parse localStorage on every keystroke.
// touchRecent is the only writer in the app, so cache invalidation is just
// "update both sides whenever we write."
let recentsCache: Record<string, number> | null = null;

// Run a side-effect during idle time. Used for analytics dispatches that
// shouldn't compete with paint or input handling — even invoke()'s
// synchronous serialize step is enough to nudge a frame budget.
function scheduleIdle(fn: () => void) {
  type RIC = (cb: () => void, opts?: { timeout: number }) => number;
  const ric = (window as unknown as { requestIdleCallback?: RIC })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout: 2000 });
  else window.setTimeout(fn, 0);
}

function loadRecents(): Record<string, number> {
  if (recentsCache) return recentsCache;
  try {
    const v = localStorage.getItem(RECENTS_KEY);
    recentsCache = v ? JSON.parse(v) : {};
  } catch {
    recentsCache = {};
  }
  return recentsCache!;
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
  const map = { ...loadRecents() };
  map[key] = Date.now();
  // Keep only the most recent MAX_RECENTS so this never grows unbounded.
  const trimmed = Object.fromEntries(
    Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX_RECENTS)
  );
  recentsCache = trimmed;
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
  // Filter against a deferred query so the input updates paint before the
  // list re-renders. On first keystroke the user sees the character land
  // instantly; the (cheap) list update follows on the next frame.
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>(initialFilter ?? null);
  const [clipboardEntries, setClipboardEntries] = useState<PaletteEntry[]>([]);
  const [fileEntries, setFileEntries] = useState<PaletteEntry[]>([]);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [themeEntries, setThemeEntries] = useState<PaletteEntry[]>([]);
  const [skillEntries, setSkillEntries] = useState<PaletteEntry[]>([]);
  // Perf measurement: stamp time on input event, measure to next paint
  // via double-rAF. Pill auto-fades. Helps verify first-keystroke is fast.
  const inputStampRef = useRef<number | null>(null);
  // Tracks whether the next keystroke is the first one in the current
  // session — that's the one the user feels as "open + type". Subsequent
  // keystrokes are warm-path. Logged distinctly in analytics.
  const firstKeystrokeRef = useRef(true);
  const [perfText, setPerfText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const deleteTimer = useRef<number | null>(null);
  // Tracks whether the most recent input was the mouse. Keyboard nav flips
  // this to false; the next real mousemove flips it back to true. Without
  // this, scrolling the list under a stationary cursor fires onMouseEnter
  // on whatever row landed under the pointer and yanks the selection back.
  const mouseActiveRef = useRef(true);

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
  // something useful immediately. Screenshot mode uses a dedicated query
  // path (uses screenshot_dirs from settings, sorted by mtime).
  useEffect(() => {
    if (kindFilter !== "file") return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const fetcher = screenshotMode
        ? api.searchScreenshots(50)
        : api.searchFiles(parseFileQuery(query));
      fetcher
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
  }, [query, kindFilter, screenshotMode, onError]);

  // Leaving file mode (e.g. Escape, blur) drops the screenshot flag.
  useEffect(() => {
    if (kindFilter !== "file") setScreenshotMode(false);
  }, [kindFilter]);

  // Theme picker — list_themes is fast (mostly built-ins), fetched once
  // each time the filter is set.
  useEffect(() => {
    if (kindFilter !== "theme") return;
    let cancelled = false;
    api
      .listThemes()
      .then((rows) => {
        if (cancelled) return;
        setThemeEntries(
          rows.map((r) => ({ kind: "theme" as const, ...r }))
        );
      })
      .catch((e) => onError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [kindFilter, onError]);

  // Skills — scan ~/.claude/skills + plugin caches each time the filter
  // is opened so a freshly-installed skill shows up immediately.
  useEffect(() => {
    if (kindFilter !== "skill") return;
    let cancelled = false;
    api
      .listSkills()
      .then((rows) => {
        if (cancelled) return;
        setSkillEntries(
          rows.map((r) => ({ kind: "skill" as const, ...r }))
        );
      })
      .catch((e) => onError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [kindFilter, onError]);

  const visibleEntries = useMemo(() => {
    if (kindFilter === "clipboard") return clipboardEntries;
    if (kindFilter === "file") return fileEntries;
    if (kindFilter === "theme") return themeEntries;
    if (kindFilter === "skill") return skillEntries;
    if (kindFilter) return entries.filter((e) => e.kind === kindFilter);
    // Unfiltered view: respect inline-display settings. Vite/Docker entries
    // are still reachable via "Show Vite Ports" / "Show Docker Containers"
    // commands, which set a kindFilter and bypass this rule.
    return entries.filter((e) => {
      if (e.kind === "vite" && !settings.show_vite_inline) return false;
      if (e.kind === "docker" && !settings.show_docker_inline) return false;
      if (e.kind === "snippet" && !settings.show_snippets_inline) return false;
      if (e.kind === "quicklink" && !settings.show_quicklinks_inline) return false;
      return true;
    });
  }, [entries, clipboardEntries, fileEntries, themeEntries, skillEntries, kindFilter, settings]);

  // Lazy Fuse: building the index over hundreds of entries with 11 keys is
  // ~30–100ms and was happening synchronously inside useMemo on every
  // entries change — landing right on the user's first keystroke. Now we
  // build it only when actually needed (a 3+ char query), and pre-warm on
  // requestIdleCallback so even the third character doesn't pay the cost.
  const fuseRef = useRef<{ entries: PaletteEntry[]; fuse: Fuse<PaletteEntry> } | null>(null);
  const getFuse = (): Fuse<PaletteEntry> => {
    if (fuseRef.current && fuseRef.current.entries === visibleEntries) {
      return fuseRef.current.fuse;
    }
    const fuse = new Fuse(visibleEntries, FUSE_OPTIONS);
    fuseRef.current = { entries: visibleEntries, fuse };
    return fuse;
  };

  // Pre-warm the Fuse index on idle whenever the entries set changes,
  // so the 3rd-char path doesn't pay first-build cost.
  useEffect(() => {
    type RIC = (cb: () => void, opts?: { timeout: number }) => number;
    type CIC = (id: number) => void;
    const ric = (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback;
    const cic = (window as unknown as { cancelIdleCallback?: CIC }).cancelIdleCallback;
    const handle = ric
      ? ric(() => { getFuse(); }, { timeout: 1500 })
      : (window.setTimeout(() => { getFuse(); }, 400) as unknown as number);
    return () => {
      if (cic && ric) cic(handle);
      else window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEntries]);

  const filtered = useMemo(() => {
    // File mode is fully resolved by the backend (fd does the matching);
    // skip Fuse entirely so we don't filter the results twice.
    if (kindFilter === "file") return visibleEntries.slice(0, MAX_VISIBLE);
    const q = deferredQuery.trim();
    const recents = loadRecents();
    if (!q) {
      // Empty query order:
      //   1) recents — what you actually use, newest first
      //   2) kind priority — apps > your items > plugins > clipboard
      //   3) alphabetical name — predictable tiebreaker
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
      return ranked.slice(0, MAX_VISIBLE_EMPTY);
    }
    const ql = q.toLowerCase();
    // Short queries: skip Fuse entirely. With threshold 0.35 + ignoreLocation
    // and 11 weighted keys, scoring every entry against a 1-char query is the
    // dominant cost of first-letter latency — and the result is mostly noise
    // (substring hits with weak scores). For 1-2 chars, what the user actually
    // wants is "starts-with on name or keyword", which is O(n) and trivial.
    if (q.length <= 2) {
      const matches: PaletteEntry[] = [];
      for (const e of visibleEntries) {
        if (nameOf(e).toLowerCase().startsWith(ql)) {
          matches.push(e);
          continue;
        }
        const kw = (e as { keyword?: string }).keyword;
        if (kw && kw.toLowerCase().startsWith(ql)) matches.push(e);
      }
      matches.sort((a, b) => {
        const ra = recents[entryKey(a)] ?? 0;
        const rb = recents[entryKey(b)] ?? 0;
        if (ra !== rb) return rb - ra;
        const pa = kindPriority(a);
        const pb = kindPriority(b);
        if (pa !== pb) return pa - pb;
        return nameOf(a).localeCompare(nameOf(b));
      });
      return matches.slice(0, MAX_VISIBLE);
    }
    const results = getFuse().search(q);
    // Adjust Fuse's raw match score with two boosts:
    //   - prefix bonus: strong (-0.4) — typing "i" should land on iTerm,
    //     not on something that fuzzy-contains an i three chars deep.
    //   - recents bonus: gentler (-0.18) — what you actually use beats
    //     equally-good matches you've never picked.
    // Lower effective score = better, same as Fuse.
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
    return scored.slice(0, MAX_VISIBLE).map((r) => r.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery, visibleEntries, kindFilter]);

  // Two-part measurement:
  //   - input paint: time from keystroke to the input element committing
  //     with the new char. This is what the user *feels*.
  //   - list paint: time from keystroke to the filtered list committing.
  //     With useDeferredValue these can be a frame or two apart.
  // Double-rAF on each to wait for actual paint, not just commit.
  const lastInputPaintRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (inputStampRef.current == null) return;
    const start = inputStampRef.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lastInputPaintRef.current = performance.now() - start;
      });
    });
  }, [query]);
  useLayoutEffect(() => {
    if (inputStampRef.current == null) return;
    const start = inputStampRef.current;
    inputStampRef.current = null;
    const wasFirst = firstKeystrokeRef.current;
    firstKeystrokeRef.current = false;
    const sessionId = session.id;
    const qLen = deferredQuery.length;
    const resultCount = filtered.length;
    const filterKind = kindFilter;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const listMs = performance.now() - start;
        const inputMs = lastInputPaintRef.current ?? listMs;
        const text = `in ${inputMs.toFixed(0)} · list ${listMs.toFixed(0)} · ${resultCount}`;
        // eslint-disable-next-line no-console
        console.log(`[davidcast perf] ${text}${wasFirst ? " [FIRST]" : ""}`);
        setPerfText(text);
        window.setTimeout(() => setPerfText(null), 1200);
        // Defer the analytics IPC to idle time. invoke() does a synchronous
        // serialize step that, while small, has no business running on the
        // keystroke→paint critical path. By the time idle fires we've
        // already painted; the metric write happens off-screen-time.
        scheduleIdle(() => {
          api
            .analyticsRecord(sessionId, "perf_keystroke", {
              input_ms: Number(inputMs.toFixed(2)),
              list_ms: Number(listMs.toFixed(2)),
              result_count: resultCount,
              q_len: qLen,
              first_in_session: wasFirst,
              kind_filter: filterKind,
            })
            .catch(() => {});
        });
      });
    });
  }, [filtered, deferredQuery, kindFilter, session.id]);

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

  // Real mouse motion — distinguishes "user is actively pointing" from
  // "list scrolled under a stationary cursor and accidentally re-hovered".
  useEffect(() => {
    const onMove = () => {
      mouseActiveRef.current = true;
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
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
      firstKeystrokeRef.current = true;
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
          case "themes.switch":
            setQuery("");
            setKindFilter("theme");
            break;
          case "files.screenshots":
            // Dedicated mode: scans the user-configured screenshot dirs
            // (default ~/Desktop), shows a side preview, and copies the
            // path on Enter rather than the bitmap.
            setQuery("");
            setKindFilter("file");
            setScreenshotMode(true);
            api
              .searchScreenshots(50)
              .then((rows) => {
                setFileEntries(
                  rows.map((r) => ({ kind: "file" as const, ...r }))
                );
              })
              .catch((e) => onError(String(e)));
            break;
          case "skills.search":
            setQuery("");
            setKindFilter("skill");
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
      } else if (isTheme(entry)) {
        const t = await api.setActiveTheme(entry.id);
        applyTheme(t);
        setToast(`Theme: ${t.name}`);
        window.setTimeout(() => setToast(null), 800);
      } else if (isClipboard(entry)) {
        await api.executeClipboard(entry.id);
        setToast("Pasted from history");
        window.setTimeout(() => setToast(null), 800);
      } else if (isFile(entry)) {
        // Screenshot mode: default action is to copy the path (ready to
        // paste into Slack/email/an issue), not the bitmap. The user can
        // still Cmd+Shift+C to copy the image content if they need it.
        if (screenshotMode) {
          await api.copyFilePath(entry.path);
          setToast("Path copied");
          window.setTimeout(() => setToast(null), 700);
        } else if (entry.is_image) {
          await api.copyFileImage(entry.path);
          setToast("Image copied to clipboard");
          window.setTimeout(() => setToast(null), 1100);
        } else {
          await api.openFile(entry.path);
        }
      } else if (isSkill(entry)) {
        // Default action: copy the SKILL.md path so the user can paste
        // it into a chat or open it from another tool. ⌘↵ opens it in
        // the default editor; ⌘⇧C copies the file's full markdown
        // contents (handy for pasting the whole skill into a prompt).
        await api.copyFilePath(entry.path);
        setToast("Path copied");
        window.setTimeout(() => setToast(null), 700);
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
      mouseActiveRef.current = false;
      setSelected((s) => Math.min(filtered.length - 1, s + 1));
      return;
    }
    if (e.key === "ArrowUp" || (ctrlOnly && (e.key === "p" || e.key === "k"))) {
      e.preventDefault();
      mouseActiveRef.current = false;
      setSelected((s) => Math.max(0, s - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[selected];
      if (!entry) return;
      // ⌘↵ on a file or skill forces "open in default app" even for
      // images (whose default action would otherwise copy the bitmap)
      // and for skills (whose default action is path-copy).
      if (cmd && (isFile(entry) || isSkill(entry))) {
        api
          .openFile(entry.path)
          .catch((err) => onError(String(err)));
        return;
      }
      execute(entry);
      return;
    }

    // Path-bearing row shortcuts: copy path / reveal in Finder.
    // Files and skills both expose a `path` field and share the same
    // shortcuts (⌘C, ⌘⇧C, ⌘R).
    const pathEntry = (() => {
      const entry = filtered[selected];
      if (!entry) return null;
      if (isFile(entry)) return { path: entry.path, kind: "file" as const, isImage: entry.is_image };
      if (isSkill(entry)) return { path: entry.path, kind: "skill" as const, isImage: false };
      return null;
    })();
    if (cmd && pathEntry && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      if (e.shiftKey && pathEntry.kind === "file" && pathEntry.isImage) {
        // ⌘⇧C on an image copies the bitmap.
        api
          .copyFileImage(pathEntry.path)
          .then(() => {
            setToast("Image copied to clipboard");
            window.setTimeout(() => setToast(null), 1100);
          })
          .catch((err) => onError(String(err)));
      } else if (e.shiftKey && pathEntry.kind === "skill") {
        // ⌘⇧C on a skill copies the markdown body — handy for pasting
        // the whole skill into a chat prompt.
        api
          .readSkill(pathEntry.path)
          .then(async (body) => {
            await navigator.clipboard.writeText(body);
            setToast("Skill copied to clipboard");
            window.setTimeout(() => setToast(null), 900);
          })
          .catch((err) => onError(String(err)));
      } else {
        api
          .copyFilePath(pathEntry.path)
          .then(() => {
            setToast("Path copied");
            window.setTimeout(() => setToast(null), 700);
          })
          .catch((err) => onError(String(err)));
      }
      return;
    }
    if (cmd && pathEntry && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      api.revealFile(pathEntry.path).catch((err) => onError(String(err)));
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

  // Selected entry — used both by execute() and by the side preview pane.
  const selectedEntry = filtered[selected];
  const showSidePreview = screenshotMode || kindFilter === "skill";

  // Stable refs / handlers so memo'd Row doesn't re-render unnecessarily.
  // execute() is a closure over half the component's state — capturing it
  // in a ref means Row's onClick stays referentially stable across renders.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const executeRef = useRef(execute);
  executeRef.current = execute;
  const handleHover = useCallback((i: number) => {
    if (mouseActiveRef.current) setSelected(i);
  }, []);
  const handleClick = useCallback((i: number) => {
    const entry = filteredRef.current[i];
    if (entry) executeRef.current(entry);
  }, []);

  return (
    <div
      className={`palette${showSidePreview ? " with-preview" : ""}`}
      onKeyDown={handleKey}
    >
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
          onChange={(e) => {
            inputStampRef.current = performance.now();
            setQuery(e.target.value);
            // Batch the selection reset into the same render so we don't
            // spend an extra commit fixing it up.
            setSelected(0);
          }}
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
              index={i}
              onHover={handleHover}
              onClick={handleClick}
            />
          ))
        )}
      </div>

      <div className="footer">
        {screenshotMode ? (
          <>
            <span><kbd>↵</kbd>Copy path</span>
            <span><kbd>⌘⇧C</kbd>Copy image</span>
            <span><kbd>⌘↵</kbd>Open</span>
            <span><kbd>⌘R</kbd>Reveal</span>
            <div className="footer-spacer" />
            <span><kbd>esc</kbd>Close</span>
          </>
        ) : kindFilter === "skill" ? (
          <>
            <span><kbd>↵</kbd>Copy path</span>
            <span><kbd>⌘⇧C</kbd>Copy contents</span>
            <span><kbd>⌘↵</kbd>Open in editor</span>
            <span><kbd>⌘R</kbd>Reveal</span>
            <div className="footer-spacer" />
            <span><kbd>esc</kbd>Close</span>
          </>
        ) : (
          <>
            <span><kbd>↵</kbd>Run</span>
            <span><kbd>⌃N</kbd>/<kbd>⌃P</kbd>Nav</span>
            <span><kbd>⌘N</kbd>New</span>
            <span><kbd>⌘E</kbd>Edit</span>
            <span><kbd>⌘⌫</kbd>Delete</span>
            <div className="footer-spacer" />
            <span><kbd>⌘⇧V</kbd>Clipboard</span>
            <span><kbd>⌘K</kbd>Workspace</span>
            <span><kbd>esc</kbd>Close</span>
          </>
        )}
      </div>

      {screenshotMode && (
        <ScreenshotPreview
          entry={selectedEntry && isFile(selectedEntry) ? selectedEntry : null}
        />
      )}
      {kindFilter === "skill" && !screenshotMode && (
        <SkillPreview
          entry={selectedEntry && isSkill(selectedEntry) ? selectedEntry : null}
        />
      )}

      {perfText && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            color: "rgba(255,255,255,0.55)",
            background: "rgba(0,0,0,0.35)",
            padding: "2px 6px",
            borderRadius: 4,
            pointerEvents: "none",
            letterSpacing: 0.2,
            zIndex: 50,
          }}
        >
          {perfText}
        </div>
      )}
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
  if (isTheme(e)) return `theme:${e.id}`;
  if (isClipboard(e)) return `clip:${e.id}`;
  if (isSkill(e)) return `skill:${e.path}`;
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
    case "skill":
      return 8;
    case "theme":
      return 9;
    case "clipboard":
      return 10;
  }
}

function nameOf(e: PaletteEntry): string {
  if (e.kind === "agent") return e.project;
  if (e.kind === "vite") return e.project;
  if (e.kind === "docker") return e.name;
  if (e.kind === "file") return e.name;
  if (e.kind === "theme") return e.name;
  if (e.kind === "skill") return e.name;
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
    case "theme":
      return "Themes";
    case "skill":
      return "Skills";
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
    case "theme":
      return "Pick a theme — ↵ applies it, drop JSONs in ~/.../davidcast/themes";
    case "skill":
      return "Search Claude Code skills — ↵ copies path, ⌘↵ opens, ⌘⇧C copies contents";
    default:
      return "Type to search — snippets, quicklinks, apps, agents, commands…";
  }
}

// ---------- Row ----------

const Row = memo(function Row({
  entry,
  selected,
  index,
  onHover,
  onClick,
}: {
  entry: PaletteEntry;
  selected: boolean;
  index: number;
  onHover: (i: number) => void;
  onClick: (i: number) => void;
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
    // Never show the snippet body in the row — values can carry
    // secrets (passwords, tokens) and the palette is often visible
    // in screen-shares / recordings. Keyword (if any) gets the slot.
    sub = entry.keyword ? `keyword: ${entry.keyword}` : "";
    badge = entry.sensitive ? "🔒 Sensitive" : "Snippet";
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
  } else if (isTheme(entry)) {
    name = entry.name;
    sub = entry.builtin ? "Built-in" : "Custom (JSON)";
    badge = "Theme";
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
  } else if (isSkill(entry)) {
    name = entry.name;
    sub = entry.description || entry.path;
    badge = entry.source === "user" ? "Skill" : `Skill · ${entry.source}`;
  }

  const keyword =
    (isSnippet(entry) || isQuicklink(entry)) && entry.keyword
      ? entry.keyword
      : null;

  return (
    <div
      className={`row ${selected ? "active" : ""}`}
      onClick={() => onClick(index)}
      onMouseEnter={() => onHover(index)}
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
});

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
  if (isTheme(entry)) {
    return <ThemeSwatch theme={entry} />;
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
  if (isSkill(entry)) {
    return (
      <div className="row-icon glyph skill">
        <SkillGlyph />
      </div>
    );
  }
  return <div className="row-icon glyph" />;
}

// Themes are visualised as a tiny swatch — the row icon shows the theme's
// own bg + accent so the picker is itself a preview.
function ThemeSwatch({ theme }: { theme: import("../types").Theme }) {
  const bg = theme.tokens.bg ?? "#1c1c20";
  const accent = theme.tokens.accent ?? "#7bd88f";
  return (
    <div
      className="row-icon"
      style={{
        background: bg,
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: accent,
          display: "inline-block",
        }}
      />
    </div>
  );
}

// Side-panel preview for the screenshot mode. Shows the currently
// selected file's image at a useful size + its metadata.
function ScreenshotPreview({
  entry,
}: {
  entry: ({ kind: "file" } & import("../types").FileEntry) | null;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!entry) {
      setSrc(null);
      return;
    }
    const cached = THUMB_CACHE.get(entry.path);
    if (cached !== undefined) {
      setSrc(cached);
      return;
    }
    let cancelled = false;
    api
      .fileThumbnail(entry.path)
      .then((url) => {
        if (cancelled) return;
        THUMB_CACHE.set(entry.path, url);
        setSrc(url);
      })
      .catch(() => {
        if (cancelled) return;
        THUMB_CACHE.set(entry.path, null);
        setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry?.path]);

  if (!entry) {
    return (
      <aside className="preview-pane">
        <div className="preview-empty">No selection</div>
      </aside>
    );
  }
  return (
    <aside className="preview-pane">
      <div className="preview-image">
        {src ? (
          <img src={src} alt={entry.name} draggable={false} />
        ) : (
          <div className="preview-fallback">
            {entry.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="preview-meta">
        <div className="preview-name" title={entry.name}>
          {entry.name}
        </div>
        <div className="preview-sub">{entry.parent}</div>
        <div className="preview-sub">
          {formatSize(entry.size)} ·{" "}
          {relativeTime(new Date(entry.modified_at).toISOString())}
        </div>
      </div>
    </aside>
  );
}

// Side-panel preview for a SKILL.md — shows the description (from
// frontmatter) on top, then the raw markdown body. The body is loaded
// lazily on selection change and cached so navigating with arrow keys
// doesn't re-read the file each time.
function SkillPreview({
  entry,
}: {
  entry: ({ kind: "skill" } & import("../types").SkillEntry) | null;
}) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    if (!entry) {
      setBody(null);
      return;
    }
    const cached = SKILL_BODY_CACHE.get(entry.path);
    if (cached !== undefined) {
      setBody(cached);
      return;
    }
    let cancelled = false;
    api
      .readSkill(entry.path)
      .then((b) => {
        if (cancelled) return;
        SKILL_BODY_CACHE.set(entry.path, b);
        setBody(b);
      })
      .catch(() => {
        if (cancelled) return;
        SKILL_BODY_CACHE.set(entry.path, "");
        setBody("");
      });
    return () => {
      cancelled = true;
    };
  }, [entry?.path]);

  if (!entry) {
    return (
      <aside className="preview-pane">
        <div className="preview-empty">No selection</div>
      </aside>
    );
  }
  return (
    <aside className="preview-pane skill-preview">
      <div className="preview-meta">
        <div className="preview-name" title={entry.name}>
          {entry.name}
        </div>
        <div className="preview-sub">
          {entry.source === "user" ? "Personal skill" : `Plugin · ${entry.source}`}
        </div>
        {entry.description && (
          <div className="skill-description">{entry.description}</div>
        )}
      </div>
      <div className="skill-body">
        {body === null ? (
          <div className="preview-empty">Loading…</div>
        ) : body === "" ? (
          <div className="preview-empty">(empty body)</div>
        ) : (
          <pre>{body}</pre>
        )}
      </div>
    </aside>
  );
}

const SKILL_BODY_CACHE = new Map<string, string>();

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
function SkillGlyph() {
  // Open book — skills are read like documentation.
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2 3 L8 4 L14 3 L14 13 L8 14 L2 13 Z M8 4 L8 14"
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
