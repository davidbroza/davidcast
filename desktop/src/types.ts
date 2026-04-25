export interface Snippet {
  id: string;
  name: string;
  keyword?: string;
  text: string;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
  rev?: number;
}

export interface Quicklink {
  id: string;
  name: string;
  keyword?: string;
  url: string;
  open_in: OpenIn;
  created_at: string;
  updated_at: string;
  deleted?: boolean;
  rev?: number;
}

export type OpenIn = "default_browser" | "chrome" | "safari";

export interface Workspace {
  id: string;
  name: string;
  color?: string;
}

export interface WorkspaceList {
  workspaces: Workspace[];
  active: string;
}

export interface AppEntry {
  name: string;
  path: string;
}

export interface CommandEntry {
  id: string;
  name: string;
  subtitle: string;
}

export interface GitInfo {
  is_repo: boolean;
  branch: string | null;
  dirty: boolean;
}

export interface AgentEntry {
  pid: number;
  cwd: string;
  project: string;
  tty: string;
  command: string;
  elapsed: string;
  terminal_app: string;
  git: GitInfo;
}

export interface VitePortEntry {
  pid: number;
  port: number;
  host: string;
  url: string;
  cwd: string;
  project: string;
  command: string;
  elapsed: string;
  git: GitInfo;
}

export interface DockerEntry {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  mode: "shell" | "logs";
}

export interface FileEntry {
  path: string;
  name: string;
  parent: string;
  size: number;
  modified_at: number;
  is_image: boolean;
  ext: string;
}

export interface FileSearchOpts {
  query?: string;
  extensions?: string[];
  category?: string;
  roots?: string[];
  sort_by_mtime?: boolean;
  limit?: number;
}

export interface ClipboardEntry {
  id: string;
  text: string;
  copied_at: string;
  char_count: number;
}

export type Item =
  | ({ kind: "snippet" } & Snippet)
  | ({ kind: "quicklink" } & Quicklink);

export type PaletteEntry =
  | ({ kind: "command" } & CommandEntry)
  | ({ kind: "snippet" } & Snippet)
  | ({ kind: "quicklink" } & Quicklink)
  | ({ kind: "app" } & AppEntry)
  | ({ kind: "agent" } & AgentEntry)
  | ({ kind: "vite" } & VitePortEntry)
  | ({ kind: "docker" } & DockerEntry)
  | ({ kind: "file" } & FileEntry)
  | ({ kind: "clipboard" } & ClipboardEntry);

export function isSnippet(i: Item | PaletteEntry): i is { kind: "snippet" } & Snippet {
  return i.kind === "snippet";
}

export function isQuicklink(i: Item | PaletteEntry): i is { kind: "quicklink" } & Quicklink {
  return i.kind === "quicklink";
}

export function isApp(i: PaletteEntry): i is { kind: "app" } & AppEntry {
  return i.kind === "app";
}

export function isCommand(i: PaletteEntry): i is { kind: "command" } & CommandEntry {
  return i.kind === "command";
}

export function isAgent(i: PaletteEntry): i is { kind: "agent" } & AgentEntry {
  return i.kind === "agent";
}

export function isVite(i: PaletteEntry): i is { kind: "vite" } & VitePortEntry {
  return i.kind === "vite";
}

export function isDocker(
  i: PaletteEntry
): i is { kind: "docker" } & DockerEntry {
  return i.kind === "docker";
}

export function isFile(i: PaletteEntry): i is { kind: "file" } & FileEntry {
  return i.kind === "file";
}

export function isClipboard(
  i: PaletteEntry
): i is { kind: "clipboard" } & ClipboardEntry {
  return i.kind === "clipboard";
}

export function asItem(e: PaletteEntry): Item | null {
  if (e.kind === "snippet") return { ...e };
  if (e.kind === "quicklink") return { ...e };
  return null;
}

export function extractPlaceholders(url: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(url)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
