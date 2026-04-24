import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Workspace } from "../types";

type Props = {
  workspaces: Workspace[];
  activeId: string;
  onClose: () => void;
  onSwitched: () => Promise<void>;
  onError: (msg: string) => void;
};

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onClose,
  onSwitched,
  onError,
}: Props) {
  const [selected, setSelected] = useState(() =>
    Math.max(0, workspaces.findIndex((w) => w.id === activeId))
  );
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  async function switchTo(id: string) {
    try {
      if (id !== activeId) {
        await api.setActiveWorkspace(id);
        await onSwitched();
      }
      onClose();
    } catch (e) {
      onError(String(e));
    }
  }

  async function createAndSwitch() {
    const name = newName.trim();
    if (!name) return;
    try {
      const ws = await api.createWorkspace(name);
      await api.setActiveWorkspace(ws.id);
      await onSwitched();
      onClose();
    } catch (e) {
      onError(String(e));
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (creating) {
      if (e.key === "Escape") {
        e.preventDefault();
        setCreating(false);
        setNewName("");
      } else if (e.key === "Enter") {
        e.preventDefault();
        createAndSwitch();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(workspaces.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const ws = workspaces[selected];
      if (ws) switchTo(ws.id);
    } else if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setCreating(true);
    } else if (/^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const idx = parseInt(e.key, 10) - 1;
      const ws = workspaces[idx];
      if (ws) switchTo(ws.id);
    }
  }

  return (
    <div
      className="overlay"
      onClick={onClose}
      onKeyDown={handleKey}
      tabIndex={-1}
      ref={rootRef}
    >
      <div className="overlay-panel" onClick={(e) => e.stopPropagation()}>
        {creating ? (
          <div className="form-field" style={{ padding: 6 }}>
            <label>Workspace name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Work"
              autoFocus
            />
            <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 6 }}>
              <kbd>↵</kbd> create · <kbd>esc</kbd> cancel
            </div>
          </div>
        ) : (
          <>
            {workspaces.map((w, i) => (
              <div
                key={w.id}
                className={`overlay-row ${i === selected ? "active" : ""}`}
                onClick={() => switchTo(w.id)}
                onMouseEnter={() => setSelected(i)}
              >
                <span
                  className="workspace-dot"
                  style={w.color ? { background: w.color } : undefined}
                />
                <span>{w.name}</span>
                {w.id === activeId && (
                  <span style={{ color: "var(--fg-dim)", fontSize: 11 }}>active</span>
                )}
                <span className="num">⌘{i + 1}</span>
              </div>
            ))}
            <div
              className="overlay-row"
              onClick={() => setCreating(true)}
              style={{ color: "var(--fg-dim)" }}
            >
              + New workspace <span className="num">⌘N</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
