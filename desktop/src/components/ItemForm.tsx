import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Item, OpenIn } from "../types";
import { isQuicklink, isSnippet } from "../types";

type Props = {
  initial?: Item; // undefined = create mode
  presetKind?: "snippet" | "quicklink";
  onDone: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
};

type Kind = "snippet" | "quicklink";

export function ItemForm({ initial, presetKind, onDone, onCancel, onError }: Props) {
  const editing = !!initial;
  const [kind, setKind] = useState<Kind>(
    initial ? (initial.kind as Kind) : (presetKind ?? "snippet")
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [keyword, setKeyword] = useState(initial?.keyword ?? "");
  const [text, setText] = useState(initial && isSnippet(initial) ? initial.text : "");
  const [url, setUrl] = useState(initial && isQuicklink(initial) ? initial.url : "");
  const [openIn, setOpenIn] = useState<OpenIn>(
    initial && isQuicklink(initial) ? initial.open_in : "default_browser"
  );
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function save() {
    if (saving) return;
    if (!name.trim()) {
      onError("Name is required");
      return;
    }
    const kw = keyword.trim() || undefined;
    setSaving(true);
    try {
      if (kind === "snippet") {
        if (!text.trim()) {
          onError("Text is required for snippets");
          setSaving(false);
          return;
        }
        if (editing && initial && isSnippet(initial)) {
          await api.updateSnippet({
            id: initial.id,
            name,
            text,
            keyword: kw ?? null,
          });
        } else {
          await api.createSnippet({ name, text, keyword: kw });
        }
      } else {
        if (!url.trim()) {
          onError("URL is required for quicklinks");
          setSaving(false);
          return;
        }
        if (editing && initial && isQuicklink(initial)) {
          await api.updateQuicklink({
            id: initial.id,
            name,
            url,
            keyword: kw ?? null,
            open_in: openIn,
          });
        } else {
          await api.createQuicklink({ name, url, keyword: kw, open_in: openIn });
        }
      }
      onDone();
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  }

  return (
    <div className="palette" onKeyDown={handleKey}>
      <div className="form">
        <div className="form-header">
          <div className="form-title">{editing ? "Edit item" : "New item"}</div>
          {!editing && (
            <div className="tab-switch">
              <button
                className={kind === "snippet" ? "active" : ""}
                onClick={() => setKind("snippet")}
                type="button"
              >
                Snippet
              </button>
              <button
                className={kind === "quicklink" ? "active" : ""}
                onClick={() => setKind("quicklink")}
                type="button"
              >
                Quicklink
              </button>
            </div>
          )}
        </div>

        <div className="form-body">
          <div className="form-field">
            <label>Name</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Email signature"
            />
          </div>
          <div className="form-field">
            <label>Keyword (optional)</label>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. sig"
              spellCheck={false}
            />
          </div>
          {kind === "snippet" ? (
            <div className="form-field">
              <label>Text</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste content..."
              />
            </div>
          ) : (
            <>
              <div className="form-field">
                <label>URL (use {"{placeholder}"} for arguments)</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://github.com/search?q={query}"
                  spellCheck={false}
                />
              </div>
              <div className="form-field">
                <label>Open in</label>
                <select
                  value={openIn}
                  onChange={(e) => setOpenIn(e.target.value as OpenIn)}
                >
                  <option value="default_browser">Default browser</option>
                  <option value="chrome">Google Chrome</option>
                  <option value="safari">Safari</option>
                </select>
              </div>
            </>
          )}
        </div>

        <div className="footer">
          <span><kbd>⌘↵</kbd>Save</span>
          <span><kbd>esc</kbd>Cancel</span>
          <div className="footer-spacer" />
          {saving && <span>Saving...</span>}
        </div>
      </div>
    </div>
  );
}
