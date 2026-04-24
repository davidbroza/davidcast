# davidcast

Personal launcher — global hotkey palette for snippets and quicklinks, with workspaces. Local-first, built to sync across devices in phase 2.

See [`PLAN.md`](./PLAN.md) for the full design.

## Status

**Phase 1 — macOS desktop app (shipped):**
- Global hotkey palette (`⌥ Space`)
- Snippets (copy + paste at cursor via macOS Accessibility)
- Quicklinks with `{placeholder}` argument substitution; opens in default browser, Chrome, or Safari
- Workspaces (switch with `⌘K`, manage in Preferences)
- Menu-bar tray icon (click opens palette, right-click for menu)
- Preferences window with launch-at-login toggle
- Import from Raycast JSON exports (Quicklinks & Snippets), with syntax normalization
- JSON store with sync-ready schema: UUID v7, `updated_at`, tombstones, `rev`

**Phase 2 — next:**
- Chrome extension with the same palette, talking to a local HTTP API
- Cloudflare Worker sync so multiple devices share one store

**Phase 3:**
- MCP server so Claude can CRUD snippets/quicklinks
- iCloud Drive sync as a zero-infra option for Mac-to-Mac

## Layout

- `desktop/` — Tauri app (macOS)
- `extension/` — Chrome extension (phase 2)
- `worker/` — Cloudflare sync worker (phase 2)
- `mcp/` — MCP server (phase 3)

## Running in dev

```bash
cd desktop
pnpm install
pnpm tauri dev
```

First compile takes a couple of minutes; subsequent runs are fast. A tray icon appears in the menu bar — click it, or press `⌥ Space` from anywhere.

## Building a release app

```bash
cd desktop
pnpm tauri build
```

Outputs `src-tauri/target/release/bundle/macos/davidcast.app` and an unsigned `.dmg`. Since it's unsigned, on first launch right-click → Open to bypass Gatekeeper.

## First-run setup (macOS)

To paste snippets at the cursor, davidcast needs **Accessibility** permission.

1. Trigger a snippet paste once — macOS prompts, or silently fails.
2. Open **System Settings → Privacy & Security → Accessibility**.
3. Enable `davidcast` (during dev, whichever terminal launched `pnpm tauri dev`).

The hotkey is `⌥ Space`. If Raycast is installed with the same binding, rebind one of them.

## Keybindings

Inside the palette:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Navigate results |
| `↵` | Run the selected item |
| `⌘N` | New snippet or quicklink |
| `⌘E` | Edit selected |
| `⌘⌫` | Delete selected |
| `⌘K` | Switch workspace (then `⌘1…9` to jump, `⌘N` for new workspace) |
| `esc` | Close palette |

Inside create/edit form:

| Key | Action |
| --- | --- |
| `⌘↵` | Save |
| `esc` | Cancel |

## Importing from Raycast

1. In Raycast, run **Export Quicklinks** and **Export Snippets** — you'll get two JSON files.
2. Open davidcast Preferences (tray → Preferences…).
3. In the Import section, paste the path to each file and click Import. Run twice, once per file.

Raycast's `{argument name="x" placeholder="..."}` syntax is automatically rewritten to our `{x}` form. `openWith` bundle IDs map to the right browser.

## Data location

```
~/Library/Application Support/davidcast/
├── config.json                 # workspaces + active
└── workspaces/
    ├── personal/
    │   ├── snippets.json
    │   ├── quicklinks.json
    │   └── sync_state.json     # populated in phase 2
    └── work/
        └── …
```

Files are plain JSON — safe to hand-edit, diff, or sync through iCloud Drive by moving the directory.

## Dev requirements

- Node 20+ with pnpm
- Rust stable (1.80+)
- Xcode command line tools (macOS)
