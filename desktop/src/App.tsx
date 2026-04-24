import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { ItemForm } from "./components/ItemForm";
import { Palette } from "./components/Palette";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { api } from "./api";
import type { Item, Workspace } from "./types";
import "./palette.css";

type View =
  | { kind: "palette" }
  | { kind: "create" }
  | { kind: "edit"; item: Item }
  | { kind: "workspace-switcher" };

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<string>("");
  const [view, setView] = useState<View>({ kind: "palette" });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [ws, its] = await Promise.all([api.listWorkspaces(), api.listItems()]);
    setWorkspaces(ws.workspaces);
    setActiveWorkspace(ws.active);
    setItems(its);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  // When the palette is re-shown via hotkey, reset to base view and refetch.
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

  return (
    <>
      {view.kind === "create" && (
        <ItemForm
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
          items={items}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace}
          onNew={() => setView({ kind: "create" })}
          onEdit={(item) => setView({ kind: "edit", item })}
          onSwitchWorkspace={() => setView({ kind: "workspace-switcher" })}
          refresh={refresh}
          onError={setError}
        />
      )}
      {view.kind === "workspace-switcher" && (
        <>
          <Palette
            items={items}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspace}
            onNew={() => setView({ kind: "create" })}
            onEdit={(item) => setView({ kind: "edit", item })}
            onSwitchWorkspace={() => setView({ kind: "workspace-switcher" })}
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
        <div className="form-error" style={{ position: "absolute", bottom: 36, left: 0, right: 0 }}>
          {error}
        </div>
      )}
    </>
  );
}
