import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Item, PaletteEntry, Workspace } from "../types";
import {
  asItem,
  extractPlaceholders,
  isAgent,
  isApp,
  isCommand,
  isQuicklink,
  isSnippet,
} from "../types";

type KindFilter = PaletteEntry["kind"] | null;

type Props = {
  entries: PaletteEntry[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onEdit: (item: Item) => void;
  onCommand: (id: string) => void;
  refresh: () => Promise<void>;
  onError: (msg: string) => void;
};

export function Palette({
  entries,
  workspaces,
  activeWorkspaceId,
  onEdit,
  onCommand,
  refresh,
  onError,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const deleteTimer = useRef<number | null>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  const visibleEntries = useMemo(
    () => (kindFilter ? entries.filter((e) => e.kind === kindFilter) : entries),
    [entries, kindFilter]
  );

  const fuse = useMemo(
    () =>
      new Fuse(visibleEntries, {
        keys: [
          { name: "keyword", weight: 3 },
          { name: "name", weight: 2 },
          { name: "project", weight: 2 },
          { name: "subtitle", weight: 0.8 },
          { name: "url", weight: 0.4 },
          { name: "text", weight: 0.3 },
          { name: "path", weight: 0.2 },
          { name: "cwd", weight: 0.2 },
        ],
        // Tighter threshold = fewer weak matches bubbling into the list;
        // includeScore lets us tiebreak deterministically below.
        threshold: 0.35,
        ignoreLocation: true,
        includeScore: true,
        minMatchCharLength: 1,
      }),
    [visibleEntries]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return visibleEntries;
    const results = fuse.search(q);
    // Primary: Fuse score. Secondary (stable): kind priority. Tertiary: name.
    // Without a tiebreaker the list can jitter on near-identical scores.
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
  }, [query, fuse]);

  // Reset position only when the query changes — not when the list itself
  // changes (e.g. after a delete). That way you stay in place.
  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Clamp the selection if the list got shorter (e.g. the item we deleted
  // was last, so selected would point past the end).
  useEffect(() => {
    setSelected((s) => {
      const max = Math.max(0, filtered.length - 1);
      return Math.min(s, max);
    });
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLDivElement>(".row.active");
    active?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  async function execute(entry: PaletteEntry) {
    try {
      if (isCommand(entry)) {
        // Intercept commands we can handle inline before bubbling up.
        if (entry.id === "show.agents") {
          setQuery("");
          setKindFilter("agent");
          return;
        }
        onCommand(entry.id);
      } else if (isApp(entry)) {
        await api.executeApp(entry.path);
      } else if (isAgent(entry)) {
        await api.executeAgent({
          pid: entry.pid,
          tty: entry.tty,
          terminal_app: entry.terminal_app,
        });
      } else if (isSnippet(entry)) {
        // Copy immediately, show toast, then hide+paste after a beat so the
        // confirmation is visible before focus returns to the prior app.
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
          if (v === null) return;
          args[p] = v;
        }
        await api.executeQuicklink(entry.id, args);
      }
    } catch (e) {
      onError(String(e));
    }
  }

  async function handleKey(e: React.KeyboardEvent) {
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    const cmd = e.metaKey;

    // ----- Navigation (arrows, vim j/k, emacs n/p) -----
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

    // ----- Run / close -----
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

    // ----- Inline editing shortcuts (readline-ish) -----
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

    // ----- Item-level shortcuts (Cmd) -----
    if (cmd && e.key === "n") {
      e.preventDefault();
      onCommand("create.snippet"); // default new-item; pick via form tabs
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
      const item = entry && asItem(entry);
      if (!item) return;
      await requestDelete(item);
      return;
    }
  }

  async function requestDelete(item: Item) {
    if (pendingDelete && pendingDelete.id === item.id) {
      // Second press = confirm.
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
    // First press = arm.
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
          placeholder={
            kindFilter === "agent"
              ? "Search running agents by project…"
              : "Type to search — snippets, quicklinks, apps, agents, commands…"
          }
          autoFocus
          spellCheck={false}
        />
      </div>

      <div className="results" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="empty">
            <h3>No matches</h3>
            <p>
              Try a different search or <kbd>⌘N</kbd> to create a new item.
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
  return `${e.kind}:${e.id}`;
}

function kindPriority(e: PaletteEntry): number {
  switch (e.kind) {
    case "command":
      return 0;
    case "agent":
      return 1;
    case "snippet":
      return 2;
    case "quicklink":
      return 3;
    case "app":
      return 4;
  }
}

function nameOf(e: PaletteEntry): string {
  if (e.kind === "agent") return e.project;
  return (e as { name?: string }).name ?? "";
}

function filterLabel(k: PaletteEntry["kind"]): string {
  switch (k) {
    case "agent":
      return "Agents";
    case "snippet":
      return "Snippets";
    case "quicklink":
      return "Quicklinks";
    case "app":
      return "Apps";
    case "command":
      return "Commands";
  }
}

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
  let iconClass = "";
  let iconChar = "";
  let name = "";
  let sub = "";
  let badge = "";

  if (isCommand(entry)) {
    iconClass = "command";
    iconChar = "⚡";
    name = entry.name;
    sub = entry.subtitle;
    badge = "Command";
  } else if (isApp(entry)) {
    iconClass = "app";
    iconChar = entry.name.charAt(0).toUpperCase();
    name = entry.name;
    sub = entry.path;
    badge = "App";
  } else if (isSnippet(entry)) {
    iconClass = "snippet";
    iconChar = "S";
    name = entry.name;
    sub = oneLine(entry.text);
    badge = "Snippet";
  } else if (isQuicklink(entry)) {
    iconClass = "quicklink";
    iconChar = "Q";
    name = entry.name;
    sub = entry.url;
    badge = "Quicklink";
  } else if (isAgent(entry)) {
    iconClass = "agent";
    iconChar = "▸";
    name = entry.project || "unknown project";
    sub = `${entry.cwd} · ${entry.terminal_app} · ${entry.elapsed}`;
    badge = "Agent";
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
      <div className={`row-icon ${iconClass}`}>{iconChar}</div>
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

function oneLine(t: string): string {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}
