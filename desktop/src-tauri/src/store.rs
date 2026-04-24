use crate::types::*;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct Store {
    pub root: PathBuf,
    pub config: Config,
}

impl Store {
    pub fn load() -> Result<Self, StoreError> {
        let root = Self::root_dir()?;
        std::fs::create_dir_all(&root)?;
        let config_path = root.join("config.json");
        let config = if config_path.exists() {
            serde_json::from_str(&std::fs::read_to_string(&config_path)?)?
        } else {
            let c = Config::default();
            Self::ensure_workspace_dir(&root, &c.active_workspace)?;
            write_json(&config_path, &c)?;
            c
        };
        Self::ensure_workspace_dir(&root, &config.active_workspace)?;
        Ok(Self { root, config })
    }

    pub fn root_dir() -> Result<PathBuf, StoreError> {
        // macOS: ~/Library/Application Support/davidcast
        // Linux: ~/.local/share/davidcast
        // Windows: %APPDATA%\davidcast
        let base = dirs::data_dir().ok_or(StoreError::NoDataDir)?;
        Ok(base.join("davidcast"))
    }

    pub fn ensure_workspace_dir(root: &Path, id: &str) -> Result<(), StoreError> {
        std::fs::create_dir_all(root.join("workspaces").join(id))?;
        Ok(())
    }

    pub fn workspace_dir(&self) -> PathBuf {
        self.root.join("workspaces").join(&self.config.active_workspace)
    }

    pub fn save_config(&self) -> Result<(), StoreError> {
        write_json(&self.root.join("config.json"), &self.config)
    }

    pub fn load_snippets(&self) -> Result<Vec<Snippet>, StoreError> {
        read_json_or_default(&self.workspace_dir().join("snippets.json"))
    }

    pub fn save_snippets(&self, v: &[Snippet]) -> Result<(), StoreError> {
        write_json(&self.workspace_dir().join("snippets.json"), &v.to_vec())
    }

    pub fn load_quicklinks(&self) -> Result<Vec<Quicklink>, StoreError> {
        read_json_or_default(&self.workspace_dir().join("quicklinks.json"))
    }

    pub fn save_quicklinks(&self, v: &[Quicklink]) -> Result<(), StoreError> {
        write_json(&self.workspace_dir().join("quicklinks.json"), &v.to_vec())
    }
}

fn read_json_or_default<T>(path: &Path) -> Result<T, StoreError>
where
    T: serde::de::DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<(), StoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(v)?;
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all().ok();
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no data directory")]
    NoDataDir,
}
