import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Item, Workspace } from "../types";
import { isQuicklink, isSnippet, extractPlaceholders } from "../types";

type Props = {
  items: Item[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onNew: () => void;
  onEdit: (item: Item) => void;
  onSwitchWorkspace: () => void;
  refresh: () => Promise<void>;
  onError: (msg: string) => void;
};

export function Palette({
  items,
  workspaces,
  activeWorkspaceId,
  onNew,
  onEdit,
  onSwitchWorkspace,
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
      new Fuse(items, {
        keys: ["name", "keyword", "url", "text"],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [items]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return items;
    return fuse.search(q).map((r) => r.item);
  }, [query, items, fuse]);

  useEffect(() => {
    setSelected(0);
  }, [query, items.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLDivElement>(".row.active");
    active?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  async function execute(item: Item) {
    try {
      if (isSnippet(item)) {
        await api.executeSnippet(item.id);
      } else if (isQuicklink(item)) {
        const placeholders = extractPlaceholders(item.url);
        const args: Record<string, string> = {};
        if (placeholders.length > 0) {
          // MVP: prompt for each placeholder inline. A fancier UI lands later.
          for (const p of placeholders) {
            const v = window.prompt(`${p}?`, "");
            if (v === null) return;
            args[p] = v;
          }
        }
        await api.executeQuicklink(item.id, args);
      }
    } catch (e) {
      onError(String(e));
    }
  }

  async function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[selected];
      if (item) execute(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      api.hidePalette();
    } else if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onNew();
    } else if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSwitchWorkspace();
    } else if (e.key === "e" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const item = filtered[selected];
      if (item) onEdit(item);
    } else if ((e.key === "Backspace" || e.key === "Delete") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const item = filtered[selected];
      if (!item) return;
      if (!window.confirm(`Delete "${item.name}"?`)) return;
      try {
        if (isSnippet(item)) await api.deleteSnippet(item.id);
        else if (isQuicklink(item)) await api.deleteQuicklink(item.id);
        await refresh();
      } catch (err) {
        onError(String(err));
      }
    }
  }

  return (
    <div className="palette" onKeyDown={handleKey}>
      <div className="topbar">
        <div className="workspace-pill" onClick={onSwitchWorkspace} title="Switch workspace (⌘K)">
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
          placeholder="Search snippets and quicklinks..."
          autoFocus
          spellCheck={false}
        />
      </div>

      <div className="results" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="empty">
            {items.length === 0 ? (
              <>
                <h3>No items yet</h3>
                <p>
                  Press <kbd>⌘N</kbd> to create your first snippet or quicklink.
                </p>
              </>
            ) : (
              <>
                <h3>No matches</h3>
                <p>Try a different search or <kbd>⌘N</kbd> to create a new item.</p>
              </>
            )}
          </div>
        ) : (
          filtered.map((item, i) => (
            <div
              key={item.id}
              className={`row ${i === selected ? "active" : ""}`}
              onClick={() => execute(item)}
              onMouseEnter={() => setSelected(i)}
            >
              <div className={`row-icon ${item.kind}`}>
                {item.kind === "snippet" ? "S" : "Q"}
              </div>
              <div className="row-main">
                <div className="row-name">{item.name}</div>
                <div className="row-sub">
                  {isSnippet(item) ? previewText(item.text) : item.url}
                </div>
              </div>
              <div className="row-right">
                {item.keyword && <span className="keyword">{item.keyword}</span>}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="footer">
        <span><kbd>↵</kbd>Run</span>
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

function previewText(t: string): string {
  const single = t.replace(/\s+/g, " ").trim();
  return single.length > 80 ? single.slice(0, 77) + "..." : single;
}
