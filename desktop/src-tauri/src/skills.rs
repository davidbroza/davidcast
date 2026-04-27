//! Claude Code skills browser. Skills are markdown files at well-known
//! locations on disk:
//!   - `~/.claude/skills/<name>/SKILL.md` — the user's personal skills
//!   - `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md`
//!     — skills installed via marketplace plugins
//!
//! Each SKILL.md begins with a YAML frontmatter block carrying `name` and
//! `description`. We parse just those two fields (no full YAML parser —
//! it's not worth the dep) and surface the rest of the file as preview body.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct SkillEntry {
    /// Stable id used by Fuse + recents — `<source>:<name>`.
    pub id: String,
    /// `name:` from the frontmatter, or the directory name if missing.
    pub name: String,
    /// `description:` from the frontmatter — usually a long sentence.
    pub description: String,
    /// Absolute path to SKILL.md.
    pub path: String,
    /// "user" for ~/.claude/skills, otherwise "<plugin>" for marketplace plugins.
    pub source: String,
    /// Bytes — useful for the "is this a beefy skill" preview hint.
    pub size: u64,
    /// Unix milliseconds.
    pub modified_at: u64,
}

/// Enumerate every SKILL.md we can find under the standard roots.
/// Symlinks are followed (the user has `~/.claude/skills/<name>` symlinks
/// pointing into `~/.agents/skills/<name>` — we want both to surface as
/// the same entry, deduped by path).
pub fn list_skills() -> Vec<SkillEntry> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let mut out: Vec<SkillEntry> = Vec::new();

    // 1. User skills: ~/.claude/skills/<name>/SKILL.md
    let user_root = home.join(".claude").join("skills");
    if let Ok(rd) = fs::read_dir(&user_root) {
        for entry in rd.flatten() {
            let skill_md = entry.path().join("SKILL.md");
            if let Some(e) = decorate(&skill_md, "user") {
                out.push(e);
            }
        }
    }

    // 2. Plugin skills: ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
    let plugins_root = home.join(".claude").join("plugins").join("cache");
    if let Ok(markets) = fs::read_dir(&plugins_root) {
        for market in markets.flatten() {
            let Ok(plugins) = fs::read_dir(market.path()) else {
                continue;
            };
            for plugin in plugins.flatten() {
                let plugin_name = plugin
                    .file_name()
                    .to_string_lossy()
                    .into_owned();
                let Ok(versions) = fs::read_dir(plugin.path()) else {
                    continue;
                };
                for version in versions.flatten() {
                    let skills_dir = version.path().join("skills");
                    let Ok(skills) = fs::read_dir(&skills_dir) else {
                        continue;
                    };
                    for skill in skills.flatten() {
                        let skill_md = skill.path().join("SKILL.md");
                        if let Some(e) = decorate(&skill_md, &plugin_name) {
                            out.push(e);
                        }
                    }
                }
            }
        }
    }

    // Sort: user skills first (most relevant), then alphabetical by name.
    out.sort_by(|a, b| {
        let key_a = (a.source != "user", a.name.to_lowercase());
        let key_b = (b.source != "user", b.name.to_lowercase());
        key_a.cmp(&key_b)
    });

    // Dedupe by canonical path so symlinks don't double up.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    out.retain(|e| {
        let key = fs::canonicalize(&e.path)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| e.path.clone());
        seen.insert(key)
    });

    out
}

fn decorate(skill_md: &Path, source: &str) -> Option<SkillEntry> {
    let meta = fs::metadata(skill_md).ok()?;
    if !meta.is_file() {
        return None;
    }
    let dir_name = skill_md
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        .unwrap_or("skill")
        .to_string();
    // Read just enough to parse the frontmatter — most SKILL.md files
    // are small (< 50 KB) so we read the whole thing and don't bother
    // streaming.
    let content = fs::read_to_string(skill_md).ok()?;
    let (name, description) = parse_frontmatter(&content);
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(SkillEntry {
        id: format!("{}:{}", source, dir_name),
        name: name.unwrap_or(dir_name.clone()),
        description: description.unwrap_or_default(),
        path: skill_md.to_string_lossy().into_owned(),
        source: source.to_string(),
        size: meta.len(),
        modified_at,
    })
}

/// Hand-rolled YAML frontmatter scan. Returns (name, description) if
/// the file starts with `---\n...\n---\n`. We only look for two keys —
/// no full YAML parser, no escape handling, no block scalars. Skill
/// frontmatter is conventionally simple `key: value` lines.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut current_key: Option<&'static str> = None;
    let mut buf = String::new();
    for raw in lines {
        let trimmed = raw.trim_end();
        if trimmed.trim() == "---" {
            break;
        }
        // Continuation of a previous folded value: indented line.
        if let Some(key) = current_key {
            if raw.starts_with(' ') || raw.starts_with('\t') {
                if !buf.is_empty() {
                    buf.push(' ');
                }
                buf.push_str(trimmed.trim());
                set(&mut name, &mut description, key, &buf);
                continue;
            }
            current_key = None;
        }
        if let Some(rest) = trimmed.strip_prefix("name:") {
            current_key = Some("name");
            buf = strip_quotes(rest.trim()).to_string();
            set(&mut name, &mut description, "name", &buf);
        } else if let Some(rest) = trimmed.strip_prefix("description:") {
            current_key = Some("description");
            buf = strip_quotes(rest.trim()).to_string();
            set(&mut name, &mut description, "description", &buf);
        }
    }
    (name, description)
}

fn set(
    name: &mut Option<String>,
    description: &mut Option<String>,
    key: &str,
    value: &str,
) {
    let v = value.trim().to_string();
    if v.is_empty() {
        return;
    }
    match key {
        "name" => *name = Some(v),
        "description" => *description = Some(v),
        _ => {}
    }
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Read the SKILL.md file and return the body (everything after the
/// closing `---` of the frontmatter). Capped at 200 KB so a runaway
/// skill can't freeze the preview pane.
pub fn read_body(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let meta = fs::metadata(p).map_err(|e| format!("stat: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let content = fs::read_to_string(p).map_err(|e| format!("read: {e}"))?;
    let body = strip_frontmatter(&content);
    Ok(body.chars().take(200_000).collect())
}

fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return content;
    }
    // Find the first newline after the opening marker.
    let after_open = match trimmed.find('\n') {
        Some(i) => &trimmed[i + 1..],
        None => return content,
    };
    // Find a line that is exactly `---` (closing marker).
    let mut cursor = 0usize;
    for line in after_open.split_inclusive('\n') {
        if line.trim_end_matches('\n').trim() == "---" {
            return after_open[cursor + line.len()..].trim_start();
        }
        cursor += line.len();
    }
    content
}

/// Convenience: list of root directories the plugin scans, returned so
/// the help / preferences UI can show "where do these come from?".
#[allow(dead_code)]
pub fn skill_roots() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    vec![
        home.join(".claude").join("skills"),
        home.join(".claude").join("plugins").join("cache"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_frontmatter() {
        let s = "---\nname: foo\ndescription: a skill\n---\n# Body\nmore";
        let (n, d) = parse_frontmatter(s);
        assert_eq!(n.as_deref(), Some("foo"));
        assert_eq!(d.as_deref(), Some("a skill"));
    }

    #[test]
    fn parse_frontmatter_with_quotes() {
        let s = "---\nname: \"foo bar\"\ndescription: 'baz'\n---\n";
        let (n, d) = parse_frontmatter(s);
        assert_eq!(n.as_deref(), Some("foo bar"));
        assert_eq!(d.as_deref(), Some("baz"));
    }

    #[test]
    fn parse_no_frontmatter() {
        let s = "# Just a markdown file\n\nWith content";
        let (n, d) = parse_frontmatter(s);
        assert!(n.is_none());
        assert!(d.is_none());
    }

    #[test]
    fn strip_frontmatter_returns_body() {
        let s = "---\nname: foo\n---\n# Body line\nmore";
        assert_eq!(strip_frontmatter(s), "# Body line\nmore");
    }

    #[test]
    fn strip_frontmatter_no_marker_returns_original() {
        let s = "# No frontmatter here\nbody";
        assert_eq!(strip_frontmatter(s), s);
    }

    #[test]
    fn parse_folded_description() {
        // A description that wraps across multiple indented lines.
        let s = "---\nname: x\ndescription: this is\n  a folded description\n  across lines\n---\n";
        let (_, d) = parse_frontmatter(s);
        assert_eq!(d.as_deref(), Some("this is a folded description across lines"));
    }
}
