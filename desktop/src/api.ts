import { invoke } from "@tauri-apps/api/core";
import type {
  Item,
  OpenIn,
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

  // Import
  importFromFile: (path: string) =>
    invoke<{ snippets: number; quicklinks: number; skipped: number }>(
      "import_from_file",
      { path }
    ),
};
