# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `desktop/` (the only active package; `extension/`, `worker/`, `mcp/` in `PLAN.md` are aspirational and not yet scaffolded).

```bash
pnpm install                  # bootstrap (pnpm only — pnpm-lock.yaml is committed)
pnpm tauri dev                # full dev: vite on :1420 + Rust hot reload
pnpm dev                      # frontend-only (rarely useful — no Tauri APIs)
pnpm build                    # tsc --noEmit + vite build (this IS the typecheck)
pnpm tauri build              # release .app at src-tauri/target/release/bundle/macos/

cargo test --manifest-path src-tauri/Cargo.toml                  # all Rust tests
cargo test --manifest-path src-tauri/Cargo.toml <name>           # one test by name
cargo check --manifest-path src-tauri/Cargo.toml                 # fast Rust typecheck
```

There is no JS test runner and no separate lint step — `pnpm build` is the only frontend gate. Rust tests live inline as `#[cfg(test)] mod tests` (see `actions.rs`, `agents.rs`, `commands.rs`).

## Architecture

**One Tauri app, two webviews, one Rust core.** `desktop/src-tauri/src/lib.rs` owns startup: it loads the JSON store into a `RwLock<Store>` managed by Tauri, registers the `⌃ Space` global shortcut, builds the menu-bar tray, and sets `ActivationPolicy::Accessory` so there's no dock icon. The frontend bundle is shared between two windows — `main` (the palette) and `prefs` — distinguished at runtime by `?view=prefs` in the URL; `desktop/src/main.tsx` reads that param and mounts either `App` or `Preferences`.

**Frontend never touches disk.** Every read/write goes through Tauri commands in `commands.rs`, wrapped on the JS side by `desktop/src/api.ts`. Adding a new command requires three coordinated edits:
1. Define the `#[tauri::command]` in `commands.rs`.
2. Register it in the `invoke_handler![...]` macro in `lib.rs`.
3. Add a wrapper in `src/api.ts`.
If the command touches a window or plugin not already permitted, also add the permission to `src-tauri/capabilities/default.json`.

**Store layout is workspace-scoped, sync-ready.** `Store::load()` (`store.rs`) creates `~/Library/Application Support/davidcast/` with `config.json` (workspace list + active id) and per-workspace `workspaces/<id>/{snippets,quicklinks}.json`. Workspace membership is implicit in the file path — items themselves don't carry a `workspace` field. All writes are atomic (write-temp-then-rename in `write_json`). `delete_workspace` intentionally leaves the directory on disk for safety.

**Items are sync-shaped from day 1.** Every `Snippet` and `Quicklink` (`types.rs`) has `id` (UUIDv7), `created_at`, `updated_at`, `deleted` (tombstone — never hard-delete), and `rev` (monotonic). The phase-2 Cloudflare sync engine is designed to plug into these fields without a migration. Don't hard-delete, don't reuse fields.

**Palette is a heterogeneous list.** `list_palette` in `commands.rs` returns `Vec<PaletteEntry>` — a tagged union of `Command | Snippet | Quicklink | App | Agent`. The frontend (`components/Palette.tsx`) runs Fuse.js fuzzy search across all of them in one pass. Built-in commands (`builtin_commands()`) are how features like "Create Snippet", "Open Preferences", "Switch Workspace" surface — they're searchable entries with stable ids dispatched in `App.tsx`'s `onCommand`.

**macOS-specific bridges (osascript).** Two flows shell out to AppleScript:
- `actions.rs::paste_at_cursor` — sends `⌘V` via System Events. Fails silently without Accessibility permission; the snippet still lands on the clipboard.
- `agents.rs::activate_*` — finds the terminal tab matching a `tty` and brings it forward (iTerm2 + Terminal supported; others fall back to `open -a`).

**Agent detection.** `agents.rs` runs `ps -axo pid,ppid,etime,tty,comm,args`, filters for `claude` (direct binary or `node /.../claude/cli.js`), uses `lsof` for cwd, and climbs the PPID chain to identify the parent terminal app. Pure subprocess work — no proc filesystem assumptions.

**Window auto-hide.** The palette hides on blur (`on_window_event` in `lib.rs`) — that's intentional and what makes `⌃ Space` feel like a launcher. Don't add focus-stealing UI inside the palette window or it will dismiss itself.

## Conventions worth knowing

- **`PLAN.md` and `README.md` are authoritative** for product scope and the phased roadmap. `FEATURES_PLANNED.md` is a scratchpad — implementations there may already be shipped or may be stale.
- **No CSP** (`tauri.conf.json` sets `csp: null`) — this is intentional for the local-only app, not an oversight.
- **Raycast import quirks** live in `commands.rs::normalize_raycast_url` and `import_from_file` — Raycast's `{argument name="x"}` becomes `{x}`, and `openWith` bundle ids map to the `OpenIn` enum. Tests cover this.
- **Hotkey is hard-coded** to `⌃ Space` in `hotkey.rs::default_shortcut`. Rebinding UI is on the roadmap, not built.
- **Commit messages**: never mention Claude Code as the tool; the model name is fine (per user's global instruction).
