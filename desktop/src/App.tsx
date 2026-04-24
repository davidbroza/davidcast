import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { ItemForm } from "./components/ItemForm";
import { Palette } from "./components/Palette";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import type { Item, PaletteEntry, Workspace } from "./types";

type View =
  | { kind: "palette" }
  | { kind: "create"; presetKind: "snippet" | "quicklink" }
  | { kind: "edit"; item: Item }
  | { kind: "workspace-switcher" };

export default function App() {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>("");
  const [view, setView] = useState<View>({ kind: "palette" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [ws, list] = await Promise.all([
      api.listWorkspaces(),
      api.listPalette(),
    ]);
    setWorkspaces(ws.workspaces);
    setActiveWorkspace(ws.active);
    setEntries(list);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  useEffect(() => {
    const off = listen("palette:show", () => {
      setView({ kind: "palette" });
      setError(null);
      refresh().catch((e) => setError(String(e)));
    });
    return () => {
      off.then((fn) => fn());
    };
  }, [refresh]);

  const backToPalette = () => setView({ kind: "palette" });

  async function onCommand(id: string) {
    switch (id) {
      case "create.snippet":
        setView({ kind: "create", presetKind: "snippet" });
        break;
      case "create.quicklink":
        setView({ kind: "create", presetKind: "quicklink" });
        break;
      case "open.preferences":
        try {
          await api.showPreferences();
          await api.hidePalette();
        } catch (e) {
          setError(String(e));
        }
        break;
      case "switch.workspace":
        setView({ kind: "workspace-switcher" });
        break;
    }
  }

  return (
    <>
      {view.kind === "create" && (
        <ItemForm
          presetKind={view.presetKind}
          onDone={async () => {
            await refresh();
            backToPalette();
          }}
          onCancel={backToPalette}
          onError={setError}
        />
      )}
      {view.kind === "edit" && (
        <ItemForm
          initial={view.item}
          onDone={async () => {
            await refresh();
            backToPalette();
          }}
          onCancel={backToPalette}
          onError={setError}
        />
      )}
      {view.kind === "palette" && (
        <Palette
          entries={entries}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace}
          onEdit={(item) => setView({ kind: "edit", item })}
          onCommand={onCommand}
          refresh={refresh}
          onError={setError}
        />
      )}
      {view.kind === "workspace-switcher" && (
        <>
          <Palette
            entries={entries}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspace}
            onEdit={(item) => setView({ kind: "edit", item })}
            onCommand={onCommand}
            refresh={refresh}
            onError={setError}
          />
          <WorkspaceSwitcher
            workspaces={workspaces}
            activeId={activeWorkspace}
            onClose={backToPalette}
            onSwitched={refresh}
            onError={setError}
          />
        </>
      )}
      {error && (
        <div
          className="form-error"
          style={{ position: "absolute", bottom: 36, left: 0, right: 0 }}
        >
          {error}
        </div>
      )}
    </>
  );
}
