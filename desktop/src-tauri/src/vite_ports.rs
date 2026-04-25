use serde::Serialize;

/// One running Vite dev server (one entry per (pid, listening port) pair).
#[derive(Debug, Clone, Serialize)]
pub struct VitePortEntry {
    pub pid: i32,
    pub port: u16,
    pub host: String,
    pub url: String,
    pub cwd: String,
    pub project: String,
    pub command: String,
    pub elapsed: String,
}

pub fn list_vite_ports() -> Vec<VitePortEntry> {
    let procs = collect_vite_processes();
    if procs.is_empty() {
        return Vec::new();
    }
    let listeners = collect_listeners();

    let mut out: Vec<VitePortEntry> = Vec::new();
    for p in &procs {
        let cwd = get_cwd(p.pid).unwrap_or_default();
        let project = std::path::Path::new(&cwd)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&cwd)
            .to_string();
        for l in listeners.iter().filter(|l| l.pid == p.pid) {
            let host = if l.addr == "*" || l.addr == "0.0.0.0" || l.addr == "127.0.0.1" {
                "localhost".to_string()
            } else {
                l.addr.clone()
            };
            out.push(VitePortEntry {
                pid: p.pid,
                port: l.port,
                host: host.clone(),
                url: format!("http://{host}:{port}", port = l.port),
                cwd: cwd.clone(),
                project: project.clone(),
                command: p.args.clone(),
                elapsed: p.etime.clone(),
            });
        }
    }
    // Newest first.
    out.sort_by(|a, b| etime_seconds(&a.elapsed).cmp(&etime_seconds(&b.elapsed)));
    out
}

pub fn open_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| format!("open {url}: {e}"))?;
    Ok(())
}

struct ViteProc {
    pid: i32,
    etime: String,
    args: String,
}

fn collect_vite_processes() -> Vec<ViteProc> {
    let Ok(output) = std::process::Command::new("ps")
        .args(["-axo", "pid=,etime=,comm=,args="])
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
        .filter(|p| is_vite(&p.0, &p.1))
        .map(|(_comm, args, pid, etime)| ViteProc { pid, etime, args })
        .collect()
}

fn parse_ps_line(line: &str) -> Option<(String, String, i32, String)> {
    let s = line.trim_start();
    if s.is_empty() {
        return None;
    }
    let (pid_s, rest) = split_field(s)?;
    let (etime, rest) = split_field(rest)?;
    let (comm, args) = split_field(rest)?;
    let pid: i32 = pid_s.parse().ok()?;
    Some((
        comm.to_string(),
        args.trim_start().to_string(),
        pid,
        etime.to_string(),
    ))
}

fn split_field(s: &str) -> Option<(&str, &str)> {
    let s = s.trim_start();
    let end = s.find(char::is_whitespace)?;
    Some((&s[..end], s[end..].trim_start()))
}

/// Vite usually runs as `node /.../.bin/vite` or `node /.../vite/bin/vite.js`.
/// Cover the common shapes: pnpm/npm/bun-installed binaries, the Vite CLI
/// entry, and a literal `vite` binary on PATH.
fn is_vite(comm: &str, args: &str) -> bool {
    let comm_name = std::path::Path::new(comm)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(comm);
    if comm_name == "vite" {
        return true;
    }
    if comm_name == "node" || comm_name == "bun" {
        return looks_like_vite_args(args);
    }
    looks_like_vite_args(args)
}

fn looks_like_vite_args(args: &str) -> bool {
    args.contains("/vite/bin/vite.js")
        || args.contains("/vite/dist/node/cli.js")
        || args.contains("/.bin/vite")
        || args.contains("/.pnpm/vite@")
        || args.contains("/node_modules/vite/")
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

struct Listener {
    pid: i32,
    addr: String,
    port: u16,
}

/// One lsof call for every TCP listener on the box, parsed into (pid, addr, port).
/// We then join with the vite pid set in-memory. lsof emits one record per file
/// descriptor, so a single listening socket can show up several times — dedupe
/// by (pid, port).
fn collect_listeners() -> Vec<Listener> {
    let Ok(output) = std::process::Command::new("lsof")
        .args(["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pn"])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let mut out: Vec<Listener> = Vec::new();
    let mut seen: std::collections::HashSet<(i32, u16)> = std::collections::HashSet::new();
    let mut current_pid: Option<i32> = None;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if let Some(p) = line.strip_prefix('p') {
            current_pid = p.parse::<i32>().ok();
        } else if let Some(name) = line.strip_prefix('n') {
            let Some(pid) = current_pid else { continue };
            // `name` is like "*:5173" or "127.0.0.1:5173" or "[::1]:5173".
            // Skip IPv6 records — lsof emits both v4 and v6 listeners; we pick v4.
            if name.starts_with('[') {
                continue;
            }
            let Some((addr, port)) = name.rsplit_once(':') else {
                continue;
            };
            let Ok(port) = port.parse::<u16>() else {
                continue;
            };
            if !seen.insert((pid, port)) {
                continue;
            }
            out.push(Listener {
                pid,
                addr: addr.to_string(),
                port,
            });
        }
    }
    out
}

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
        [m, s] => (
            0,
            m.parse::<u64>().unwrap_or(0),
            s.parse::<u64>().unwrap_or(0),
        ),
        _ => (0, 0, 0),
    };
    days * 86_400 + h * 3_600 + m * 60 + s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vite_via_node_pnpm() {
        assert!(is_vite(
            "node",
            "/usr/local/bin/node /Users/x/proj/node_modules/.pnpm/vite@5.0.0/node_modules/vite/bin/vite.js"
        ));
    }

    #[test]
    fn vite_via_node_bin_link() {
        assert!(is_vite(
            "node",
            "node /Users/x/proj/node_modules/.bin/vite --host"
        ));
    }

    #[test]
    fn vite_direct_binary() {
        assert!(is_vite("vite", "vite"));
        assert!(is_vite("/Users/x/.bun/bin/vite", "/Users/x/.bun/bin/vite"));
    }

    #[test]
    fn not_vite() {
        assert!(!is_vite("node", "node server.js"));
        assert!(!is_vite("zsh", "zsh -l"));
    }
}
