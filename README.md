# davidcast

Personal launcher — global hotkey palette for snippets and quicklinks. Local-first, built to sync across devices.

See [`PLAN.md`](./PLAN.md) for the full design.

## Status

**Phase 1 (in progress):** macOS desktop app.
- Snippets (copy + paste at cursor)
- Quicklinks (with `{placeholder}` argument substitution, open in default browser / Chrome / Safari)
- Workspaces (switch with `⌘K`, create with `⌘N` inside the switcher)
- Global hotkey `⌥ Space` toggles the palette
- JSON store in `~/Library/Application Support/davidcast/`

## Layout

- `desktop/` — Tauri app (macOS)
- `extension/` — Chrome extension (phase 2)
- `worker/` — Cloudflare sync worker (phase 2)
- `mcp/` — MCP server (phase 3)

## Running the desktop app

```bash
cd desktop
pnpm install
pnpm tauri dev
```

### First-run setup on macOS

To paste snippets at the cursor, the app needs **Accessibility** permission.

1. Trigger a snippet paste once — macOS will prompt, or silently fail.
2. Open **System Settings → Privacy & Security → Accessibility**.
3. Enable `davidcast` (or during dev, the terminal process that launched `pnpm tauri dev`).

Hotkey is `⌥ Space` by default. If Raycast is installed with the same binding, rebind one of them.

## Keybindings (inside palette)

| Key | Action |
| --- | --- |
| `↑` / `↓` | Navigate results |
| `↵` | Run the selected item |
| `⌘N` | New snippet / quicklink |
| `⌘E` | Edit selected |
| `⌘⌫` | Delete selected |
| `⌘K` | Switch workspace |
| `esc` | Close palette |

## Dev requirements

- Node 20+ with pnpm
- Rust stable (1.80+)
- Xcode command line tools (macOS)
