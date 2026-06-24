//! GitHub palette plugin. Shells out to the `gh` CLI so we piggyback on
//! whatever auth the user has set up (`gh auth login`) — no token in
//! config, no keychain code. Same pattern as `backup.rs`.
//!
//! Three surfaces:
//!   * `list_open_prs(&repos)` — open PRs in each tracked repo
//!   * `list_issues_assigned_to_me()` — `gh search issues --assignee @me`
//!   * `search_issues(query, &repos)` — substring search across tracked repos
//!
//! All three return a flat `Vec` so the palette can show them as a single
//! ranked list. Repos run in parallel — one slow repo doesn't stall the rest.

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;

/// `gh` makes network calls to the GitHub API — without a hard ceiling a slow
/// or unreachable API (or an interactive auth prompt) hangs the child forever.
/// The calling command is `async` so the wait is off the UI thread, but the
/// timeout still matters so worker threads don't leak.
const GH_NET_TIMEOUT: Duration = Duration::from_secs(8);
const GH_VERSION_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequest {
    pub repo: String, // "owner/repo"
    pub number: u64,
    pub title: String,
    pub author: String,
    pub url: String,
    pub created_at: String,
    pub labels: Vec<String>,
    pub is_draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub author: String,
    pub url: String,
    pub created_at: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
}

fn gh_available() -> bool {
    let mut cmd = Command::new("gh");
    cmd.arg("--version");
    crate::proc::capture_stdout(cmd, GH_VERSION_TIMEOUT).is_some()
}

fn run_gh(args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("gh");
    cmd.args(args);
    // GIT_TERMINAL_PROMPT=0 so a missing/expired credential fails fast instead
    // of blocking on an interactive prompt that can never be answered.
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    let out = crate::proc::output_with_timeout(cmd, GH_NET_TIMEOUT)
        .map_err(|e| format!("gh {}: {e}", args.join(" ")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("gh {}: {}", args.join(" "), err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// ---------- PRs ----------

#[derive(Deserialize)]
struct GhPrJson {
    number: u64,
    title: String,
    author: GhUser,
    url: String,
    #[serde(default)]
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(default)]
    labels: Vec<GhLabel>,
    #[serde(default)]
    #[serde(rename = "isDraft")]
    is_draft: bool,
}

#[derive(Deserialize)]
struct GhUser {
    #[serde(default)]
    login: String,
}

#[derive(Deserialize)]
struct GhLabel {
    name: String,
}

fn fetch_prs_for(repo: &str) -> Result<Vec<PullRequest>, String> {
    let raw = run_gh(&[
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,author,url,createdAt,labels,isDraft",
    ])?;
    let parsed: Vec<GhPrJson> = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {repo} prs: {e}"))?;
    Ok(parsed
        .into_iter()
        .map(|p| PullRequest {
            repo: repo.to_string(),
            number: p.number,
            title: p.title,
            author: p.author.login,
            url: p.url,
            created_at: p.created_at,
            labels: p.labels.into_iter().map(|l| l.name).collect(),
            is_draft: p.is_draft,
        })
        .collect())
}

pub fn list_open_prs(repos: &[String]) -> Result<Vec<PullRequest>, String> {
    if !gh_available() {
        return Err("gh CLI not found — install it with `brew install gh`".into());
    }
    if repos.is_empty() {
        return Ok(vec![]);
    }
    // Parallel — one slow repo can't stall the rest. Errors per-repo are
    // swallowed so a single broken `--repo` value (typo, deleted repo)
    // doesn't black-hole every other repo's PRs.
    let mut handles = Vec::new();
    for repo in repos {
        let repo = repo.clone();
        handles.push(std::thread::spawn(move || fetch_prs_for(&repo)));
    }
    let mut all = Vec::new();
    for h in handles {
        if let Ok(Ok(prs)) = h.join() {
            all.extend(prs);
        }
    }
    // Newest first.
    all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(all)
}

// ---------- Issues ----------

#[derive(Deserialize)]
struct GhIssueJson {
    number: u64,
    title: String,
    #[serde(default)]
    author: Option<GhUser>,
    url: String,
    #[serde(default)]
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(default)]
    labels: Vec<GhLabel>,
    #[serde(default)]
    assignees: Vec<GhUser>,
    // For `gh search issues` results — repository.nameWithOwner.
    #[serde(default)]
    repository: Option<GhRepo>,
}

#[derive(Deserialize)]
struct GhRepo {
    #[serde(rename = "nameWithOwner")]
    name_with_owner: String,
}

fn fetch_issues_for(repo: &str, query: Option<&str>) -> Result<Vec<Issue>, String> {
    let mut args: Vec<String> = vec![
        "issue".into(),
        "list".into(),
        "--repo".into(),
        repo.to_string(),
        "--state".into(),
        "open".into(),
        "--limit".into(),
        "50".into(),
        "--json".into(),
        "number,title,author,url,createdAt,labels,assignees".into(),
    ];
    if let Some(q) = query {
        if !q.is_empty() {
            args.push("--search".into());
            args.push(q.into());
        }
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let raw = run_gh(&arg_refs)?;
    let parsed: Vec<GhIssueJson> = serde_json::from_str(&raw)
        .map_err(|e| format!("parse {repo} issues: {e}"))?;
    Ok(parsed
        .into_iter()
        .map(|i| Issue {
            repo: repo.to_string(),
            number: i.number,
            title: i.title,
            author: i.author.map(|u| u.login).unwrap_or_default(),
            url: i.url,
            created_at: i.created_at,
            labels: i.labels.into_iter().map(|l| l.name).collect(),
            assignees: i.assignees.into_iter().map(|u| u.login).collect(),
        })
        .collect())
}

pub fn search_issues(query: &str, repos: &[String]) -> Result<Vec<Issue>, String> {
    if !gh_available() {
        return Err("gh CLI not found — install it with `brew install gh`".into());
    }
    if repos.is_empty() {
        return Ok(vec![]);
    }
    let q = query.trim().to_string();
    let mut handles = Vec::new();
    for repo in repos {
        let repo = repo.clone();
        let qopt = if q.is_empty() { None } else { Some(q.clone()) };
        handles.push(std::thread::spawn(move || {
            fetch_issues_for(&repo, qopt.as_deref())
        }));
    }
    let mut all = Vec::new();
    for h in handles {
        if let Ok(Ok(issues)) = h.join() {
            all.extend(issues);
        }
    }
    all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(all)
}

pub fn list_issues_assigned_to_me() -> Result<Vec<Issue>, String> {
    if !gh_available() {
        return Err("gh CLI not found — install it with `brew install gh`".into());
    }
    let raw = run_gh(&[
        "search",
        "issues",
        "--assignee",
        "@me",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,author,url,createdAt,labels,assignees,repository",
    ])?;
    let parsed: Vec<GhIssueJson> =
        serde_json::from_str(&raw).map_err(|e| format!("parse assigned issues: {e}"))?;
    let mut all: Vec<Issue> = parsed
        .into_iter()
        .map(|i| Issue {
            repo: i
                .repository
                .map(|r| r.name_with_owner)
                .unwrap_or_default(),
            number: i.number,
            title: i.title,
            author: i.author.map(|u| u.login).unwrap_or_default(),
            url: i.url,
            created_at: i.created_at,
            labels: i.labels.into_iter().map(|l| l.name).collect(),
            assignees: i.assignees.into_iter().map(|u| u.login).collect(),
        })
        .collect();
    all.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(all)
}
