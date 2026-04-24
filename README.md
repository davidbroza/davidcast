# davidcast

Personal launcher — global hotkey palette for snippets and quicklinks. Local-first, built to sync across devices.

See [`PLAN.md`](./PLAN.md) for the full design.

## Status

Phase 1: macOS desktop app (in progress).

## Layout

- `desktop/` — Tauri app (macOS)
- `extension/` — Chrome extension (phase 2)
- `worker/` — Cloudflare sync worker (phase 2)
- `mcp/` — MCP server (phase 3)

## Dev requirements

- Node 20+ with pnpm
- Rust stable (1.80+)
- Xcode command line tools (macOS)
