# davidcast

A keyboard-first launcher for macOS. Press `⌃ Space` anywhere, type, hit Enter. Searches across your snippets, quicklinks, installed apps, and built-in commands in one place.

Built as a personal replacement for Raycast's core flows (quicklinks + snippets + app launching), with one difference: **the store is plain JSON**. You can hand-edit it, version-control it, sync it through iCloud Drive, or — soon — let Claude edit it through an MCP server.

> **Status:** Phase 1 (macOS desktop app) is live and usable. Chrome extension and cloud sync are phase 2.

---

## Why

Raycast is great, but its data lives in an encrypted SQLite database you can't script, diff, or sync across tools. davidcast keeps everything in human-readable JSON from day one, and the data model is sync-ready (UUIDv7, `updated_at`, tombstones, `rev`) so the cloud story can be bolted on without a migration.

## What it does

| | |
|---|---|
| **Global palette** | `⌃ Space` anywhere. Single input, fuzzy search. Always focused. |
| **Snippets** | Text stored on disk, pasted at cursor (or just copied — Accessibility permission optional). `{placeholder}` args supported. |
| **Quicklinks** | URL templates with `{arg}` substitution. Open in default browser, Chrome, or Safari. |
| **App launcher** | Scans `/Applications`, `/System/Applications`, `~/Applications`. Launch anything with a keyword. |
| **Built-in commands** | "Create Snippet", "Create Quicklink", "Preferences", "Switch Workspace" are searchable like items — type what you want. |
| **Workspaces** | Isolated namespaces. Personal / work / anything. Each has its own items and (eventually) its own sync target. |
| **Menu-bar only** | No dock icon. Tray menu for when you've forgotten the hotkey. |
| **Raycast import** | Paste the path of a Raycast JSON export in Preferences → Import. Handles `{argument name="x"}` → `{x}` and browser bundle IDs. |

## Install & run

### Dev

```bash
cd desktop
pnpm install
pnpm tauri dev
```

### Release app

```bash
cd desktop
pnpm tauri build
```

Produces `src-tauri/target/release/bundle/macos/davidcast.app`. Drag it into `/Applications`. Unsigned, so first launch: right-click → Open.

### First-run setup

To paste snippets at the cursor:

1. **System Settings → Privacy & Security → Accessibility**
2. Enable **davidcast**

Skipping this is fine — snippets still land on the clipboard, you just `⌘V` manually.

## Keybindings

**Palette**

| Key | Action |
|---|---|
| Type | Search everything (fuse.js fuzzy match on name, keyword, subtitle, URL, text, path) |
| `↵` | Run the selected item |
| `↑` / `↓` | Navigate |
| `⌃P` / `⌃N` | Navigate (emacs-style) |
| `⌃K` / `⌃J` | Navigate (vim-style) |
| `⌃U` | Clear the query |
| `⌃A` / `⌃E` | Jump query cursor to start / end |
| `⌘N` | New snippet / quicklink |
| `⌘E` | Edit the selected item |
| `⌘⌫` | Delete the selected item |
| `⌘K` | Switch workspace |
| `⌘,` | Open preferences |
| `esc` | Close palette |

**Create / edit form**

| Key | Action |
|---|---|
| `↹` | Move through fields: name → value → (open-in) → keyword |
| `⌘↵` | Save |
| `esc` | Cancel |

## 30-second demo

**Quicklink:**

1. `⌃ Space` → type `create quicklink` → `↵`
2. Name `GitHub search`, URL `https://github.com/search?q={query}`, Keyword `ghs`
3. `⌘↵`
4. `⌃ Space` → `ghs` → `↵` → prompts for `query`, opens GitHub

**Snippet:**

1. Copy any text (from anywhere)
2. `⌃ Space` → type `create snippet` → `↵` — the value field is already pre-filled from your clipboard
3. Name it, `⌘↵`
4. Next time: `⌃ Space` → name → `↵` → "✓ Copied to clipboard" toast, then it pastes

**App:**

1. `⌃ Space` → `iterm` → `↵` — launches iTerm

## Architecture

```
┌────────────────────────────────────────────┐
│ macOS desktop app (Tauri v2, Rust + React) │
│   ├── palette window   (borderless, blur)  │
│   ├── preferences window                   │
│   └── menu-bar tray                        │
│             │                              │
│             ▼                              │
│   Rust core                                │
│     ├── JSON store (atomic writes)         │
│     ├── global hotkey  (⌃ Space)           │
│     ├── app scanner                        │
│     ├── clipboard / osascript paste        │
│     └── Raycast import                     │
└─────────────────┬──────────────────────────┘
                  ▼
  ~/Library/Application Support/davidcast/
    config.json                  # workspaces + active
    workspaces/<id>/
      snippets.json
      quicklinks.json
      sync_state.json            # populated in phase 2
```

Every item has UUIDv7 id, `created_at` / `updated_at`, a `deleted` tombstone, and a monotonic `rev`. Phase 2 sync plugs into these fields — no migration needed.

See [`PLAN.md`](./PLAN.md) for the full design: Chrome extension, Cloudflare Worker sync, MCP server, iCloud fallback.

## Roadmap

**Phase 2 (next)**
- Local HTTP API on `127.0.0.1:47123`
- Chrome extension with the same palette UX inside the browser, hitting that API
- Cloudflare Worker + KV / D1 for cross-device sync

**Phase 3**
- MCP server so Claude can CRUD snippets and quicklinks
- iCloud Drive as a zero-infra Mac-to-Mac option
- Hotkey rebinding UI
- Real macOS app icons in the launcher (currently first-letter)
- Snippet auto-expansion on type (`;sig` → text replace, needs keystroke monitor)

## Repo layout

```
davidcast/
├── desktop/              # Tauri app (phase 1)
│   ├── src/              # React + TypeScript frontend
│   │   ├── components/   # Palette, ItemForm, WorkspaceSwitcher
│   │   ├── App.tsx       # Palette root
│   │   ├── Preferences.tsx
│   │   └── api.ts        # Tauri invoke wrappers
│   └── src-tauri/        # Rust backend
│       └── src/
│           ├── lib.rs    # tray, window events, plugin setup
│           ├── store.rs  # atomic JSON persistence
│           ├── types.rs  # Snippet, Quicklink, Workspace, Config
│           ├── apps.rs   # macOS app scanner
│           ├── hotkey.rs # global shortcut
│           ├── actions.rs # paste / open / placeholder substitution
│           └── commands.rs # Tauri command handlers
├── extension/            # Chrome extension (phase 2)
├── worker/               # Cloudflare sync worker (phase 2)
├── mcp/                  # MCP server (phase 3)
├── PLAN.md
└── README.md
```

## Dev requirements

- Node 20+ with pnpm
- Rust stable (1.80+)
- Xcode Command Line Tools (macOS)

## Decisions locked

- **Name:** davidcast
- **Stack:** Tauri v2 (Rust core + React/TS frontend)
- **Default hotkey:** `⌃ Space` (Raycast uses `⌥ Space`, so no collision during migration)
- **Local storage:** JSON files in `~/Library/Application Support/davidcast/`
- **Cloud target (phase 2):** Cloudflare Worker + KV / D1
- **macOS activation policy:** Accessory (menu-bar only, no dock)
