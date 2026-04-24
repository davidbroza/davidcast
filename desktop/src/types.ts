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

export type Item =
  | ({ kind: "snippet" } & Snippet)
  | ({ kind: "quicklink" } & Quicklink);

export type PaletteEntry =
  | ({ kind: "command" } & CommandEntry)
  | ({ kind: "snippet" } & Snippet)
  | ({ kind: "quicklink" } & Quicklink)
  | ({ kind: "app" } & AppEntry);

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
