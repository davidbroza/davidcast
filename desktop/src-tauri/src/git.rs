//! Lightweight git introspection for any working directory we already have a
//! path to. One subprocess call (`git status -b --porcelain=v2`) gives us
//! both the current branch and a dirty flag, so we don't pay for two
//! separate forks per row in the palette.
//!
//! This module is intentionally minimal — just the pieces that surface in
//! the palette today. As more git-aware features land (last commit, ahead/
//! behind, stash count) extend `GitInfo` and the parser below; the call
//! sites stay one-liners.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Default, Serialize)]
pub struct GitInfo {
    /// True if the path is inside a git working tree.
    pub is_repo: bool,
    /// Current branch name. `None` for detached HEAD or non-repos.
    pub branch: Option<String>,
    /// True if there are any tracked-but-modified or untracked files.
    pub dirty: bool,
}

/// Inspect the working tree at `path`. Always returns a `GitInfo` —
/// `is_repo: false` for paths that aren't git repos so the caller doesn't
/// need to special-case it.
pub fn info_at(path: &Path) -> GitInfo {
    let Some(p) = path.to_str() else {
        return GitInfo::default();
    };
    if p.is_empty() {
        return GitInfo::default();
    }
    let Ok(out) = std::process::Command::new("git")
        .args([
            "-C",
            p,
            "-c",
            "color.ui=never",
            "status",
            "-b",
            "--porcelain=v2",
        ])
        .output()
    else {
        return GitInfo::default();
    };
    if !out.status.success() {
        return GitInfo::default();
    }
    parse_porcelain_v2(&String::from_utf8_lossy(&out.stdout))
}

fn parse_porcelain_v2(stdout: &str) -> GitInfo {
    let mut info = GitInfo {
        is_repo: true,
        ..Default::default()
    };
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            // `(detached)` means we're on a hash, not a branch.
            if rest != "(detached)" {
                info.branch = Some(rest.to_string());
            }
        } else if !line.starts_with('#') {
            // Any non-header line indicates a changed/untracked entry.
            info.dirty = true;
        }
    }
    info
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_main_branch() {
        let out = "# branch.oid 9999\n# branch.head main\n# branch.upstream origin/main\n";
        let g = parse_porcelain_v2(out);
        assert!(g.is_repo);
        assert_eq!(g.branch.as_deref(), Some("main"));
        assert!(!g.dirty);
    }

    #[test]
    fn dirty_with_untracked() {
        let out = "# branch.head feature/x\n? new-file.txt\n";
        let g = parse_porcelain_v2(out);
        assert_eq!(g.branch.as_deref(), Some("feature/x"));
        assert!(g.dirty);
    }

    #[test]
    fn dirty_with_modified() {
        let out = "# branch.head main\n1 .M N... 100644 100644 100644 abc abc src/lib.rs\n";
        let g = parse_porcelain_v2(out);
        assert!(g.dirty);
    }

    #[test]
    fn detached_head() {
        let out = "# branch.head (detached)\n";
        let g = parse_porcelain_v2(out);
        assert!(g.is_repo);
        assert!(g.branch.is_none());
        assert!(!g.dirty);
    }
}
