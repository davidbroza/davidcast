import { invoke } from "@tauri-apps/api/core";
import type {
  ClipboardEntry,
  Item,
  OpenIn,
  PaletteEntry,
  Quicklink,
  Snippet,
  Workspace,
  WorkspaceList,
} from "./types";

export const api = {
  // Workspaces
  listWorkspaces: () => invoke<WorkspaceList>("list_workspaces"),
  setActiveWorkspace: (id: string) =>
    invoke<void>("set_active_workspace", { id }),
  createWorkspace: (name: string, color?: string) =>
    invoke<Workspace>("create_workspace", { name, color }),
  deleteWorkspace: (id: string) => invoke<void>("delete_workspace", { id }),

  // Items
  listItems: () => invoke<Item[]>("list_items"),
  listPalette: () => invoke<PaletteEntry[]>("list_palette"),
  listAgents: () => invoke<import("./types").AgentEntry[]>("list_agents"),
  listVitePorts: () =>
    invoke<import("./types").VitePortEntry[]>("list_vite_ports"),
  listDockerContainers: () =>
    invoke<import("./types").DockerEntry[]>("list_docker_containers"),
  executeApp: (path: string) => invoke<void>("execute_app", { path }),
  // Tauri converts Rust snake_case args to camelCase on the wire — `terminal_app`
  // becomes `terminalApp`. Matches `commands::execute_agent(.., terminal_app: String, ..)`.
  executeAgent: (args: { pid: number; tty: string; terminal_app: string }) =>
    invoke<void>("execute_agent", {
      pid: args.pid,
      tty: args.tty,
      terminalApp: args.terminal_app,
    }),
  executeVite: (url: string) => invoke<void>("execute_vite", { url }),
  executeDockerShell: (id: string) =>
    invoke<void>("execute_docker_shell", { id }),
  executeDockerLogs: (id: string) =>
    invoke<void>("execute_docker_logs", { id }),
  showPreferences: () => invoke<void>("show_preferences"),

  // Snippets
  createSnippet: (input: { name: string; text: string; keyword?: string }) =>
    invoke<Snippet>("create_snippet", { input }),
  updateSnippet: (input: {
    id: string;
    name?: string;
    text?: string;
    keyword?: string | null;
  }) => invoke<Snippet>("update_snippet", { input }),
  deleteSnippet: (id: string) => invoke<void>("delete_snippet", { id }),

  // Quicklinks
  createQuicklink: (input: {
    name: string;
    url: string;
    keyword?: string;
    open_in?: OpenIn;
  }) => invoke<Quicklink>("create_quicklink", { input }),
  updateQuicklink: (input: {
    id: string;
    name?: string;
    url?: string;
    keyword?: string | null;
    open_in?: OpenIn;
  }) => invoke<Quicklink>("update_quicklink", { input }),
  deleteQuicklink: (id: string) => invoke<void>("delete_quicklink", { id }),

  // Execute
  executeSnippet: (id: string) => invoke<void>("execute_snippet", { id }),
  executeQuicklink: (id: string, args?: Record<string, string>) =>
    invoke<void>("execute_quicklink", { id, args }),

  // Window
  hidePalette: () => invoke<void>("hide_palette"),
  hideAndPaste: () => invoke<void>("hide_and_paste"),

  // App icons (data URL, cached)
  getAppIcon: (path: string) =>
    invoke<string | null>("get_app_icon", { path }),

  // Clipboard history
  listClipboard: () => invoke<ClipboardEntry[]>("list_clipboard"),
  executeClipboard: (id: string) => invoke<void>("execute_clipboard", { id }),
  deleteClipboardEntry: (id: string) =>
    invoke<void>("delete_clipboard", { id }),
  clearClipboard: () => invoke<void>("clear_clipboard"),

  // Import
  importFromFile: (path: string) =>
    invoke<{ snippets: number; quicklinks: number; skipped: number }>(
      "import_from_file",
      { path }
    ),
  detectRaycast: () =>
    invoke<{ installed: boolean; path: string | null }>("detect_raycast"),
};
