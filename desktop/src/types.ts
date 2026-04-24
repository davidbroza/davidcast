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

export type Item =
  | ({ kind: "snippet" } & Snippet)
  | ({ kind: "quicklink" } & Quicklink);

export function itemKeyword(i: Item): string | undefined {
  return i.keyword;
}

export function isSnippet(i: Item): i is { kind: "snippet" } & Snippet {
  return i.kind === "snippet";
}

export function isQuicklink(i: Item): i is { kind: "quicklink" } & Quicklink {
  return i.kind === "quicklink";
}

// Extract `{placeholder}` names from a URL template.
export function extractPlaceholders(url: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(url)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
