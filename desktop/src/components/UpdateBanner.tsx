import { useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { api } from "../api";

type Props = {
  update: Update;
  onDismiss: () => void;
  onError: (msg: string) => void;
};

export function UpdateBanner({ update, onDismiss, onError }: Props) {
  const [installing, setInstalling] = useState(false);

  async function install() {
    setInstalling(true);
    try {
      // downloadAndInstall + relaunch — the relaunch call doesn't return
      // because the process is replaced.
      await api.installUpdateAndRelaunch(update);
    } catch (e) {
      setInstalling(false);
      onError(`Update install failed: ${e}`);
    }
  }

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-text">
        <strong>v{update.version}</strong> available
        <span className="update-banner-meta">
          {" — "}
          you’re on v{update.currentVersion}
        </span>
      </div>
      <div className="update-banner-actions">
        <button
          type="button"
          className="btn primary"
          onClick={install}
          disabled={installing}
        >
          {installing ? "Installing…" : "Install & restart"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={onDismiss}
          disabled={installing}
        >
          Later
        </button>
      </div>
    </div>
  );
}
