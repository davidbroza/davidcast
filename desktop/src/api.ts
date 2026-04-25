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

export interface Settings {
  show_vite_inline: boolean;
  show_docker_inline: boolean;
  screenshot_dirs: string[];
}

export const api = {
  // Settings
  getSettings: () => invoke<Settings>("get_settings"),
  setShowViteInline: (value: boolean) =>
    invoke<void>("set_show_vite_inline", { value }),
  setShowDockerInline: (value: boolean) =>
    invoke<void>("set_show_docker_inline", { value }),
  setScreenshotDirs: (value: string[]) =>
    invoke<void>("set_screenshot_dirs", { value }),
  searchScreenshots: (limit?: number) =>
    invoke<import("./types").FileEntry[]>("search_screenshots", { limit }),

  // Analytics — local-only, fire-and-forget JSONL append.
  analyticsRecord: (sessionId: string, kind: string, data: unknown) =>
    invoke<void>("analytics_record", {
      sessionId,
      kind,
      data,
    }),
  analyticsTail: (limit: number) =>
    invoke<unknown[]>("analytics_tail", { limit }),
  analyticsClear: () => invoke<void>("analytics_clear"),
  analyticsLogPath: () => invoke<string | null>("analytics_log_path"),

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

  // File search
  searchFiles: (opts: import("./types").FileSearchOpts) =>
    invoke<import("./types").FileEntry[]>("search_files", { opts }),
  openFile: (path: string) => invoke<void>("open_file", { path }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  copyFilePath: (path: string) => invoke<void>("copy_file_path", { path }),
  copyFileImage: (path: string) => invoke<void>("copy_file_image", { path }),
  fileThumbnail: (path: string) =>
    invoke<string | null>("file_thumbnail", { path }),

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
