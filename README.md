# davidcast

A keyboard-first launcher for macOS. Press `⌥ Space` anywhere, type, hit Enter. Searches across your snippets, quicklinks, installed apps, and built-in commands in one place.

Built as a personal replacement for Raycast's core flows (quicklinks + snippets + app launching), with one difference: **the store is plain JSON**. You can hand-edit it, version-control it, sync it through iCloud Drive, or — soon — let Claude edit it through an MCP server.

> **Status:** Phase 1 (macOS desktop app) is live and usable. Chrome extension and cloud sync are phase 2.

---

## Why

Raycast is great, but its data lives in an encrypted SQLite database you can't script, diff, or sync across tools. davidcast keeps everything in human-readable JSON from day one, and the data model is sync-ready (UUIDv7, `updated_at`, tombstones, `rev`) so the cloud story can be bolted on without a migration.

## What it does

| | |
|---|---|
| **Global palette** | `⌥ Space` anywhere. Single input, fuzzy search. Always focused. |
| **Snippets** | Text stored on disk, pasted at cursor (or just copied — Accessibility permission optional). `{placeholder}` args supported. |
| **Quicklinks** | URL templates with `{arg}` substitution. Open in default browser, Chrome, or Safari. |
| **App launcher** | Scans `/Applications`, `/System/Applications`, `~/Applications`. Native macOS icons, launch with a keyword. |
| **Running Claude CLI agents** | `ps` + `lsof` + ppid climb to find each terminal tab; `↵` jumps back to it. Shows the project's git branch and a dirty marker. |
| **Vite dev servers** | `lsof` joins listening ports against vite-shaped node processes; `↵` opens the URL in your default browser. |
| **Docker containers** | `docker ps` in JSON; two rows per container — `↵` opens a shell, type `logs` for `docker logs -f`. iTerm if installed, Terminal otherwise. |
| **File search** | `fd`-backed live search across configurable roots. Query syntax: `:png`, `:img`, `:newest`. Inline thumbnails for image files. |
| **Find Screenshots** | Side-preview pane on the right. `↵` copies the path, `⌘⇧C` copies the bitmap, `⌘R` reveals in Finder. Folders configurable in Preferences. |
| **Clipboard history** | Background watcher; `⌘⇧V` opens the history filter directly. |
| **Smart ranking** | Empty-query view sorts by recents (24-item localStorage cap) → kind priority → alphabetical. Typed queries get a `-0.4` prefix bonus and `-0.18` recents bonus on top of Fuse's score, so `i` lands on iTerm. |
| **Local analytics** | Append-only JSONL at `~/Library/Application Support/davidcast/analytics.jsonl` — `open`, `execute` (with kind, success, duration, query, result count), `no_results` (debounced). Local-only, never leaves the box. |
| **Built-in commands** | "Create Snippet", "Create Quicklink", "Show X" filter chips for Vite / Docker / Agents / Clipboard, "Find Files", "Find Screenshots", "Preferences", "Switch Workspace" — all searchable like items. |
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
| `⌘⌫` | Delete the selected item (two-press confirm) |
| `⌘K` | Switch workspace |
| `⌘,` | Open preferences |
| `⌘⇧V` | Open palette directly in clipboard history mode |
| `esc` | Close palette (or pop the active filter chip first) |

**File rows** (Find Files / Find Screenshots)

| Key | Action |
|---|---|
| `↵` | For images outside screenshot mode: copy bitmap. Otherwise: open. In screenshot mode: copy path. |
| `⌘↵` | Force-open in default app (even for images). |
| `⌘C` | Copy file path. |
| `⌘⇧C` | Copy image bitmap (when on an image row). |
| `⌘R` | Reveal in Finder. |

**Create / edit form**

| Key | Action |
|---|---|
| `↹` | Move through fields: name → value → (open-in) → keyword |
| `⌘↵` | Save |
| `esc` | Cancel |

## 30-second demo

**Quicklink:**

1. `⌥ Space` → type `create quicklink` → `↵`
2. Name `GitHub search`, URL `https://github.com/search?q={query}`, Keyword `ghs`
3. `⌘↵`
4. `⌥ Space` → `ghs` → `↵` → prompts for `query`, opens GitHub

**Snippet:**

1. Copy any text (from anywhere)
2. `⌥ Space` → type `create snippet` → `↵` — the value field is already pre-filled from your clipboard
3. Name it, `⌘↵`
4. Next time: `⌥ Space` → name → `↵` → "✓ Copied to clipboard" toast, then it pastes

**App:**

1. `⌥ Space` → `iterm` → `↵` — launches iTerm

**Vite dev server:**

1. `pnpm dev` in any project (Vite picks a port, e.g. 5173)
2. `⌥ Space` → type the project name → `↵` opens `http://localhost:5173`

**Docker container:**

1. `⌥ Space` → `docker` → `↵` on "Show Docker Containers" — filters to just containers
2. Find your container, `↵` shells in. Or type `logs` to find the matching `… · logs` row and tail.

**Find a screenshot fast:**

1. `⌥ Space` → `screenshots` → `↵` on "Find Screenshots"
2. Arrow through; the right-side preview updates live
3. `↵` copies the path (paste-ready). `⌘⇧C` if you want the bitmap.

## Releases

Tagging `vX.Y.Z` on `main` triggers `.github/workflows/release.yml` — it builds both Apple Silicon and Intel bundles, generates notes from `git log <prev_tag>..HEAD`, signs each `.app.tar.gz` with the auto-updater key, and publishes a GitHub Release with `.app.tar.gz` + `.app.tar.gz.sig` + `.dmg` + `latest.json` artifacts. CI (`cargo check`/`test` + `pnpm build`) runs on every push and PR; green main is the prerequisite for tagging.

## Auto-update

Installed copies of davidcast poll `https://github.com/davidbroza/davidcast/releases/latest/download/latest.json` on launch. When a newer version is available the palette shows an "Install & restart" banner — one click downloads the signed tarball, verifies the minisign signature against the public key baked into the binary, swaps `/Applications/davidcast.app`, and relaunches. The check is gated by **Preferences → Check for updates on launch** (default on); manual checks run via the `app.check_updates` built-in command.

### One-time signing-key setup (maintainers only)

Updates are signed with a minisign keypair. The public key lives in `desktop/src-tauri/tauri.conf.json::plugins.updater.pubkey`. The private key must be set as a GitHub Actions secret on this repo:

```bash
# Generate the keypair (passwordless — easier for CI):
pnpm --dir desktop tauri signer generate --ci -p '' -w ~/.tauri/davidcast.key -f

# Replace the pubkey field in tauri.conf.json with the contents of:
cat ~/.tauri/davidcast.key.pub

# Upload the private key as a GH Actions secret:
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/davidcast.key
```

Lose the private key and you can't ship updates to existing installs (the public key won't verify a key generated by anyone else). Keep `~/.tauri/davidcast.key` in 1Password / a password manager.

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
│     ├── global hotkey  (⌥ Space)           │
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

## Storage layout

Everything davidcast persists is a plain JSON (or JSONL) file under `~/Library/Application Support/davidcast/`. You can `cat`, `diff`, version, sync, and hand-edit any of it. The on-disk shape:

```
~/Library/Application Support/davidcast/
  config.json                  # workspaces + active id + per-plugin toggles
  workspaces/
    <workspace-id>/
      snippets.json            # array of Snippet
      quicklinks.json          # array of Quicklink
      sync_state.json          # populated in phase 2
  themes/
    *.json                     # any extra themes you drop in (built-ins are baked in)
  analytics.jsonl              # append-only event log, one JSON per line
  apps_cache.json              # transient: scanned /Applications results
  icons/                       # transient: extracted .icns → .png cache
```

**Workspace membership is implicit in the path.** Snippets and quicklinks don't carry a `workspace` field — moving an item between workspaces is a file move. Atomic writes (write-temp-then-rename) are used everywhere, so a kill `-9` mid-save can't corrupt the store. Deletes are tombstones (`deleted: true`), never `rm`.

### `config.json`

```jsonc
{
  "active": "ws-personal-uuid",
  "workspaces": [
    { "id": "ws-personal-uuid", "name": "personal", "color": "#7BD88F", "created_at": "..." }
  ],
  "show_vite_inline": true,
  "show_docker_inline": true,
  "show_snippets_inline": true,
  "show_quicklinks_inline": true,
  "screenshot_dirs": ["~/Desktop", "~/Pictures/Screenshots"],
  "theme": "default"
}
```

### `workspaces/<id>/snippets.json`

```jsonc
[
  {
    "id": "01941d…",                       // UUIDv7 — sortable by creation
    "name": "Email signature",
    "keyword": "sig",                      // optional shortcut for fuzzy search
    "text": "Best,\nDavid",
    "created_at": "2026-04-26T09:00:00Z",  // RFC3339 UTC
    "updated_at": "2026-04-26T09:00:00Z",
    "deleted": false,                      // tombstone
    "rev": 1                               // monotonic, bumps on every write
  }
]
```

### `workspaces/<id>/quicklinks.json`

```jsonc
[
  {
    "id": "01941d…",
    "name": "Tailwind Docs",
    "keyword": "tw",
    "url": "https://tailwindcss.com/docs?q={q}",  // {placeholder} prompts at run time
    "open_in": "default",                          // "default" | "chrome" | "safari"
    "created_at": "...",
    "updated_at": "...",
    "deleted": false,
    "rev": 1
  }
]
```

### `analytics.jsonl`

One event per line, append-only, never reordered. Three event kinds today:

```jsonc
{"ts": 1777161600000, "session_id": "<uuid>", "kind": "open",       "data": {"via": "hotkey"}}
{"ts": 1777161600500, "session_id": "<uuid>", "kind": "execute",    "data": {"kind": "App", "name": "iTerm", "outcome": "execute", "success": true, "duration_ms": 12, "q": "i", "result_count": 41, "dwell_ms": 740, "kind_filter": null}}
{"ts": 1777161601200, "session_id": "<uuid>", "kind": "no_results", "data": {"q": "zzz", "dwell_ms": 920, "kind_filter": null}}
```

`kind` is the event class; `data` is a free-form payload owned by the producer. The `show.analytics` command reads the whole file and renders top queries / items / kind breakdown / daily-opens sparkline / success rate / average dwell. **Local-only** — there is no upload code path. `analytics_clear` deletes the file. The aggregation logic is unit-tested in `desktop/src-tauri/src/analytics.rs`.

### Themes

Built-in themes ship in the binary. To add your own, drop a JSON in `themes/`:

```jsonc
{
  "id": "midnight",
  "name": "Midnight",
  "tokens": {
    "bg": "#0F0E2E",
    "fg": "#E8E8EA",
    "accent": "#818CF8"
    /* …any --css-var name from palette.css… */
  }
}
```

`themes.switch` lists everything (built-ins + your folder), and the choice is persisted as `config.theme`.

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
- **Default hotkey:** `⌥ Space` (Raycast uses `⌥ Space`, so no collision during migration)
- **Local storage:** JSON files in `~/Library/Application Support/davidcast/`
- **Cloud target (phase 2):** Cloudflare Worker + KV / D1
- **macOS activation policy:** Accessory (menu-bar only, no dock)
