import type { ReactNode } from "react";

type Props = {
  onClose: () => void;
};

// One source of truth for what davidcast can do. When a new feature
// lands, add it here AND update the matching section in CLAUDE.md so
// the agent reading the repo knows to keep this in sync.
type Feature = {
  name: string;
  command?: string;
  shortcut?: ReactNode;
  description: ReactNode;
};

type Group = {
  title: string;
  blurb?: string;
  features: Feature[];
};

const GROUPS: Group[] = [
  {
    title: "Palette basics",
    blurb: "Press ⌥ Space anywhere to open it. Type to fuzzy-search across everything.",
    features: [
      {
        name: "Toggle palette",
        shortcut: <kbd>⌥ Space</kbd>,
        description: "Global hotkey. Hides on blur so it always feels like a launcher.",
      },
      {
        name: "Run / open selected",
        shortcut: <kbd>↵</kbd>,
        description: "Default action depends on the row kind — paste a snippet, open an app, follow a quicklink, etc.",
      },
      {
        name: "Navigate",
        shortcut: <><kbd>↑</kbd>/<kbd>↓</kbd> · <kbd>⌃N</kbd>/<kbd>⌃P</kbd></>,
        description: "Arrow keys or readline-style ⌃N / ⌃P.",
      },
      {
        name: "Edit selected",
        shortcut: <kbd>⌘E</kbd>,
        description: "Snippets and quicklinks open in the inline editor.",
      },
      {
        name: "Delete selected",
        shortcut: <kbd>⌘⌫</kbd>,
        description: "Two-press confirmation — second ⌘⌫ within 4s commits.",
      },
      {
        name: "Clear filter / close",
        shortcut: <kbd>esc</kbd>,
        description: "Drops the active filter chip first, then closes the palette.",
      },
    ],
  },
  {
    title: "Snippets & Quicklinks",
    features: [
      {
        name: "Create Snippet",
        command: "create.snippet",
        shortcut: <kbd>⌘N</kbd>,
        description: "Opens the inline form. Pre-fills text from the clipboard if present.",
      },
      {
        name: "Create Quicklink",
        command: "create.quicklink",
        description: "URLs with {placeholder} arguments are prompted at run time.",
      },
      {
        name: "Search Snippets",
        command: "search.snippets",
        description: "Filter the palette down to just snippets. Useful when the inline toggle is off.",
      },
      {
        name: "Search Quicklinks",
        command: "search.quicklinks",
        description: "Same idea for quicklinks.",
      },
    ],
  },
  {
    title: "Plugins",
    blurb: "Built-in surfaces that pull from the system.",
    features: [
      {
        name: "Apps",
        description: "All /Applications and ~/Applications launchers, with their real icons.",
      },
      {
        name: "Show Running Agents",
        command: "show.agents",
        description: "Running Claude CLI sessions — Enter activates the terminal tab.",
      },
      {
        name: "Show Vite Ports",
        command: "show.vite",
        description: "Live Vite dev servers detected from `lsof`. Enter opens the URL.",
      },
      {
        name: "Show Docker Containers",
        command: "show.docker",
        description: "Running containers — two rows each (shell + logs).",
      },
      {
        name: "Find Files",
        command: "files.find",
        description: "fd-backed search. Filter tokens: :png :img :newest. ⌘C path · ⌘R reveal.",
      },
      {
        name: "Find Screenshots",
        command: "files.screenshots",
        description: "Newest screenshots first, side preview, ↵ copies path.",
      },
      {
        name: "Search Skills",
        command: "skills.search",
        description: "Browse Claude Code SKILL.md files (personal + plugin). Side preview, ↵ copies path, ⌘⇧C copies the whole skill.",
      },
      {
        name: "Show Clipboard History",
        command: "show.clipboard",
        shortcut: <kbd>⌘⇧V</kbd>,
        description: "Recent clipboard entries — Enter pastes, ⌘⌫ removes from history.",
      },
      {
        name: "Window Management",
        command: "wm.*",
        description: "Left/right/top/bottom half, maximize, center the frontmost (non-davidcast) window.",
      },
      {
        name: "Switch Theme",
        command: "themes.switch",
        description: "Built-in themes plus any JSON dropped in ~/.../davidcast/themes.",
      },
    ],
  },
  {
    title: "Workspaces",
    features: [
      {
        name: "Switch Workspace",
        command: "switch.workspace",
        shortcut: <kbd>⌘K</kbd>,
        description: "Per-workspace snippet/quicklink scope. Workspace pill in the topbar shows the active one.",
      },
      {
        name: "Manage workspaces",
        description: "Create, rename, and delete via Preferences. Deletes leave files on disk for safety.",
      },
    ],
  },
  {
    title: "Other",
    features: [
      {
        name: "Open Preferences",
        command: "open.preferences",
        shortcut: <kbd>⌘,</kbd>,
        description: "Inline preferences view — autostart, search filters, plugins, workspaces, import.",
      },
      {
        name: "Show Help",
        command: "help.show",
        description: "This screen.",
      },
      {
        name: "Show Analytics",
        command: "show.analytics",
        description: "Top queries, top items, success rate, daily activity. Reads the local JSONL — never leaves the box.",
      },
      {
        name: "Check for Updates",
        command: "app.check_updates",
        description: "Pings the GitHub Releases endpoint and downloads + installs a newer signed bundle. Auto-runs on launch unless disabled in Preferences.",
      },
      {
        name: "Backup to git",
        description: "Push the entire store to a git remote you control — Preferences → Backup. Auto-syncs every 10 min when there are changes; manual Sync now / Pull / Force push buttons too. analytics.jsonl is excluded by default for privacy.",
      },
      {
        name: "Import from Raycast",
        description: "Preferences → Import. Auto-detects Raycast snippet/quicklink JSON exports.",
      },
    ],
  },
];

export function Help({ onClose }: Props) {
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="palette help-inline" onKeyDown={handleKey} tabIndex={-1}>
      <div className="topbar">
        <div className="prefs-title">Help · davidcast</div>
        <div className="topbar-spacer" />
        <span className="topbar-hint">esc to close</span>
      </div>

      <div className="prefs-scroll">
        <div className="help">
          {GROUPS.map((group) => (
            <section key={group.title} className="help-group">
              <h2>{group.title}</h2>
              {group.blurb && <p className="help-blurb">{group.blurb}</p>}
              <div className="help-features">
                {group.features.map((f) => (
                  <div key={f.name} className="help-feature">
                    <div className="help-feature-head">
                      <span className="help-feature-name">{f.name}</span>
                      {f.shortcut && (
                        <span className="help-feature-shortcut">{f.shortcut}</span>
                      )}
                      {f.command && (
                        <code className="help-feature-cmd">{f.command}</code>
                      )}
                    </div>
                    <div className="help-feature-desc">{f.description}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div className="help-footer">
            davidcast — local-first launcher · ⌥ Space toggles the palette
          </div>
        </div>
      </div>
    </div>
  );
}
