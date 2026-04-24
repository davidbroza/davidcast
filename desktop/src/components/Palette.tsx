import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Item, PaletteEntry, Workspace } from "../types";
import {
  asItem,
  extractPlaceholders,
  isApp,
  isCommand,
  isQuicklink,
  isSnippet,
} from "../types";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  const fuse = useMemo(
    () =>
      new Fuse(entries, {
        keys: [
          { name: "name", weight: 2 },
          { name: "keyword", weight: 1.5 },
          "subtitle",
          "url",
          "text",
          "path",
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [entries]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return entries;
    return fuse.search(q).map((r) => r.item);
  }, [query, entries, fuse]);

  useEffect(() => {
    setSelected(0);
  }, [query, entries.length]);

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
        onCommand(entry.id);
      } else if (isApp(entry)) {
        await api.executeApp(entry.path);
      } else if (isSnippet(entry)) {
        await api.executeSnippet(entry.id);
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
      if (!window.confirm(`Delete "${item.name}"?`)) return;
      try {
        if (item.kind === "snippet") await api.deleteSnippet(item.id);
        else await api.deleteQuicklink(item.id);
        await refresh();
      } catch (err) {
        onError(String(err));
      }
    }
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
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to search — snippets, quicklinks, apps, commands…"
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
    </div>
  );
}

function entryKey(e: PaletteEntry): string {
  if (isCommand(e)) return `cmd:${e.id}`;
  if (isApp(e)) return `app:${e.path}`;
  return `${e.kind}:${e.id}`;
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
