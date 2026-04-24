use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct AgentEntry {
    pub pid: i32,
    pub cwd: String,
    pub project: String,
    pub tty: String,
    pub command: String,
    pub elapsed: String,
    pub terminal_app: String,
}

pub fn list_agents() -> Vec<AgentEntry> {
    let procs = collect_processes();
    let by_pid: HashMap<i32, &Proc> = procs.iter().map(|p| (p.pid, p)).collect();

    let mut out: Vec<AgentEntry> = Vec::new();
    for p in &procs {
        if !is_claude_cli(&p.comm, &p.args) {
            continue;
        }
        let cwd = get_cwd(p.pid).unwrap_or_default();
        let project = std::path::Path::new(&cwd)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&cwd)
            .to_string();
        let tty = if p.tty == "??" || p.tty.is_empty() {
            String::new()
        } else {
            format!("/dev/{}", p.tty)
        };
        let terminal_app = climb_to_terminal(&by_pid, p.pid);
        out.push(AgentEntry {
            pid: p.pid,
            cwd,
            project,
            tty,
            command: p.args.clone(),
            elapsed: p.etime.clone(),
            terminal_app,
        });
    }
    // Most recently started first.
    out.sort_by(|a, b| {
        etime_seconds(&a.elapsed).cmp(&etime_seconds(&b.elapsed))
    });
    out
}

struct Proc {
    pid: i32,
    ppid: i32,
    etime: String,
    tty: String,
    comm: String,
    args: String,
}

fn collect_processes() -> Vec<Proc> {
    let Ok(output) = std::process::Command::new("ps")
        .args(["-axo", "pid=,ppid=,etime=,tty=,comm=,args="])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_ps_line)
        .collect()
}

fn parse_ps_line(line: &str) -> Option<Proc> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return None;
    }
    let (pid_s, rest) = split_field(trimmed)?;
    let (ppid_s, rest) = split_field(rest)?;
    let (etime, rest) = split_field(rest)?;
    let (tty, rest) = split_field(rest)?;
    let (comm, args) = split_field(rest)?;
    Some(Proc {
        pid: pid_s.parse().ok()?,
        ppid: ppid_s.parse().ok()?,
        etime: etime.to_string(),
        tty: tty.to_string(),
        comm: comm.to_string(),
        args: args.trim_start().to_string(),
    })
}

fn split_field(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start();
    let end = s.find(char::is_whitespace)?;
    Some((&s[..end], &s[end..].trim_start()))
}

fn is_claude_cli(comm: &str, args: &str) -> bool {
    let comm_name = std::path::Path::new(comm)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(comm);

    if comm_name == "claude" {
        return true;
    }
    // Packaged Claude Code may run as `node /.../claude/cli.js`.
    if comm_name == "node" && looks_like_claude_args(args) {
        return true;
    }
    // Shell wrappers that end up execing claude with specific args.
    looks_like_claude_args(args)
}

fn looks_like_claude_args(args: &str) -> bool {
    args.contains("/claude/cli")
        || args.contains("claude-code")
        || args.contains("/bin/claude")
        || args.contains("/anthropic-ai/claude-code")
        || args.split_whitespace().next().map_or(false, |a| {
            std::path::Path::new(a)
                .file_name()
                .and_then(|s| s.to_str())
                == Some("claude")
        })
}

fn get_cwd(pid: i32) -> Option<String> {
    let output = std::process::Command::new("lsof")
        .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-F", "n"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|l| l.strip_prefix('n').map(|s| s.to_string()))
}

/// Walk up the PPID chain until we find a known terminal app, or reach
/// launchd. The first recognized terminal-app name wins.
fn climb_to_terminal(by_pid: &HashMap<i32, &Proc>, start: i32) -> String {
    let mut current = start;
    for _ in 0..20 {
        let Some(proc) = by_pid.get(&current) else {
            break;
        };
        let classified = classify_terminal(&proc.comm);
        if classified != "Unknown" {
            return classified;
        }
        if proc.ppid <= 1 {
            break;
        }
        current = proc.ppid;
    }
    "Unknown".into()
}

fn classify_terminal(comm: &str) -> String {
    let name = std::path::Path::new(comm)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(comm)
        .to_lowercase();
    if name.contains("iterm") {
        return "iTerm2".into();
    }
    if name == "terminal" {
        return "Terminal".into();
    }
    if name.contains("warp") {
        return "Warp".into();
    }
    if name.contains("ghostty") {
        return "Ghostty".into();
    }
    if name.contains("wezterm") {
        return "WezTerm".into();
    }
    if name.contains("kitty") {
        return "Kitty".into();
    }
    if name.contains("alacritty") {
        return "Alacritty".into();
    }
    if name.contains("hyper") {
        return "Hyper".into();
    }
    "Unknown".into()
}

/// etime comes in "MM:SS", "HH:MM:SS", or "DD-HH:MM:SS" — convert to seconds
/// for sorting. Newest first.
fn etime_seconds(etime: &str) -> u64 {
    let (days, rest) = match etime.split_once('-') {
        Some((d, r)) => (d.parse::<u64>().unwrap_or(0), r),
        None => (0, etime),
    };
    let parts: Vec<&str> = rest.split(':').collect();
    let (h, m, s) = match parts.as_slice() {
        [h, m, s] => (
            h.parse::<u64>().unwrap_or(0),
            m.parse::<u64>().unwrap_or(0),
            s.parse::<u64>().unwrap_or(0),
        ),
        [m, s] => (0, m.parse::<u64>().unwrap_or(0), s.parse::<u64>().unwrap_or(0)),
        _ => (0, 0, 0),
    };
    days * 86_400 + h * 3_600 + m * 60 + s
}

// ---------- Activation (bring the terminal tab to front) ----------

pub fn activate(agent: &AgentEntry) -> Result<(), String> {
    match agent.terminal_app.as_str() {
        "iTerm2" if !agent.tty.is_empty() => activate_iterm2(&agent.tty, &agent.terminal_app),
        "Terminal" if !agent.tty.is_empty() => activate_terminal(&agent.tty),
        _ => fallback_open(&agent.terminal_app),
    }
}

fn activate_iterm2(tty: &str, app_name: &str) -> Result<(), String> {
    let script = format!(
        r#"tell application "iTerm2"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "{tty}" then
          tell w to select
          select t
          return
        end if
      end repeat
    end repeat
  end repeat
end tell"#,
        tty = tty
    );
    if osascript(&script).is_err() {
        return fallback_open(app_name);
    }
    Ok(())
}

fn activate_terminal(tty: &str) -> Result<(), String> {
    let script = format!(
        r#"tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "{tty}" then
        set selected of t to true
        set frontmost of w to true
        return
      end if
    end repeat
  end repeat
end tell"#,
        tty = tty
    );
    if osascript(&script).is_err() {
        return fallback_open("Terminal");
    }
    Ok(())
}

fn fallback_open(app_name: &str) -> Result<(), String> {
    // Last resort: just activate the terminal app.
    let target = if app_name == "Unknown" { "Terminal" } else { app_name };
    std::process::Command::new("open")
        .args(["-a", target])
        .status()
        .map_err(|e| format!("open failed: {e}"))?;
    Ok(())
}

fn osascript(script: &str) -> Result<(), String> {
    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|e| format!("osascript spawn: {e}"))?;
    if !status.success() {
        return Err("osascript returned non-zero".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_ps_line() {
        let line = " 12345    1 01:23 ttys000    claude            claude --version";
        let p = parse_ps_line(line).unwrap();
        assert_eq!(p.pid, 12345);
        assert_eq!(p.ppid, 1);
        assert_eq!(p.etime, "01:23");
        assert_eq!(p.tty, "ttys000");
        assert_eq!(p.comm, "claude");
        assert_eq!(p.args, "claude --version");
    }

    #[test]
    fn etime_parsing() {
        assert_eq!(etime_seconds("00:30"), 30);
        assert_eq!(etime_seconds("01:02:03"), 3723);
        assert_eq!(etime_seconds("1-02:00:00"), 86_400 + 2 * 3600);
    }

    #[test]
    fn classify_known_terminals() {
        assert_eq!(classify_terminal("iTerm2"), "iTerm2");
        assert_eq!(classify_terminal("/Applications/iTerm.app/Contents/MacOS/iTerm2"), "iTerm2");
        assert_eq!(classify_terminal("Terminal"), "Terminal");
        assert_eq!(classify_terminal("ghostty"), "Ghostty");
        assert_eq!(classify_terminal("zsh"), "Unknown");
    }

    #[test]
    fn is_claude_direct_binary() {
        assert!(is_claude_cli("claude", "claude"));
        assert!(is_claude_cli(
            "/Users/me/.local/bin/claude",
            "/Users/me/.local/bin/claude --help"
        ));
    }

    #[test]
    fn is_claude_via_node() {
        assert!(is_claude_cli("node", "/usr/local/bin/node /opt/claude/cli.js"));
    }

    #[test]
    fn is_claude_negative() {
        assert!(!is_claude_cli("zsh", "zsh -l"));
        assert!(!is_claude_cli("node", "node server.js"));
    }
}
