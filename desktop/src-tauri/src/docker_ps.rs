use serde::Serialize;

/// One running Docker container as the user would see it in `docker ps`.
#[derive(Debug, Clone, Serialize)]
pub struct DockerEntry {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub ports: String,
}

pub fn list_docker_containers() -> Vec<DockerEntry> {
    // `docker ps --format '{{json .}}'` emits one JSON object per line.
    // If `docker` isn't on PATH or the daemon is down we silently return [].
    // The timeout matters: `docker ps` hangs indefinitely when the daemon is
    // starting, shutting down, or wedged — and this is on the palette-open
    // path, so a bare blocking call would freeze the whole app.
    let mut cmd = std::process::Command::new("docker");
    cmd.args(["ps", "--format", "{{json .}}"]);
    let Some(stdout) = crate::proc::capture_stdout(cmd, std::time::Duration::from_secs(3)) else {
        return Vec::new();
    };
    let mut out: Vec<DockerEntry> = Vec::new();
    for line in String::from_utf8_lossy(&stdout).lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let s = |k: &str| {
            v.get(k)
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string()
        };
        out.push(DockerEntry {
            id: s("ID"),
            name: s("Names"),
            image: s("Image"),
            status: s("Status"),
            ports: s("Ports"),
        });
    }
    out
}

/// Open a new terminal tab and drop the user into the container's shell.
/// Tries `bash`, falls back to `sh` — covers slim images.
pub fn open_shell(id: &str) -> Result<(), String> {
    if !is_safe_id(id) {
        return Err("invalid container id".into());
    }
    let cmd = format!("docker exec -it {id} /bin/sh -c 'exec bash || exec sh'");
    open_terminal_with(&cmd)
}

/// Open a new terminal tab and follow the container's logs.
pub fn open_logs(id: &str) -> Result<(), String> {
    if !is_safe_id(id) {
        return Err("invalid container id".into());
    }
    let cmd = format!("docker logs -f --tail 200 {id}");
    open_terminal_with(&cmd)
}

/// Container ids/names are alphanumerics, dashes, dots, and underscores.
/// Anything else is rejected to keep the shell command boring.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

fn open_terminal_with(command: &str) -> Result<(), String> {
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
    if std::path::Path::new("/Applications/iTerm.app").exists() {
        let script = format!(
            r#"tell application "iTerm2"
  activate
  if (count of windows) is 0 then
    create window with default profile
  else
    tell current window to create tab with default profile
  end if
  tell current session of current window to write text "{cmd}"
end tell"#,
            cmd = escaped
        );
        return osascript(&script);
    }
    let script = format!(
        r#"tell application "Terminal"
  activate
  do script "{cmd}"
end tell"#,
        cmd = escaped
    );
    osascript(&script)
}

fn osascript(script: &str) -> Result<(), String> {
    let mut cmd = std::process::Command::new("osascript");
    cmd.arg("-e").arg(script);
    // Drives Terminal/iTerm2 via Apple Events — bound it so a wedged terminal
    // app can't hang the child forever.
    let out = crate::proc::output_with_timeout(cmd, std::time::Duration::from_secs(8))?;
    if !out.status.success() {
        return Err("osascript returned non-zero".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_ids() {
        assert!(is_safe_id("a1b2c3d4e5f6"));
        assert!(is_safe_id("my-container_1.2"));
    }

    #[test]
    fn rejects_shell_meta() {
        assert!(!is_safe_id(""));
        assert!(!is_safe_id("x; rm -rf /"));
        assert!(!is_safe_id("x\"y"));
        assert!(!is_safe_id("x`y`"));
        assert!(!is_safe_id("x$y"));
    }
}
