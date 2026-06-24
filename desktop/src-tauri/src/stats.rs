//! System stats — CPU load, memory, disk, battery, thermal pressure,
//! uptime. Pure shell-out (sysctl, pmset, vm_stat, df) so no extra
//! Cargo dependency, no IOKit fiddling, no SMC reads.
//!
//! Not a live monitor — a `system_stats` command returns one snapshot
//! per call. The frontend re-invokes on a refresh button to keep the
//! ⌥Space critical path cheap (no background sampler, no keystroke jitter).

use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    // CPU
    pub load_1m: f64,
    pub load_5m: f64,
    pub load_15m: f64,
    pub cpu_count: usize,
    pub cpu_brand: String,
    // Memory (bytes)
    pub mem_total: u64,
    pub mem_used: u64,
    pub mem_pressure: Option<String>,
    // Disk (bytes) — root filesystem
    pub disk_total: u64,
    pub disk_used: u64,
    pub disk_path: String,
    // Battery
    pub battery_percent: Option<u32>,
    pub battery_state: Option<String>,
    pub battery_time_remaining: Option<String>,
    // Thermal pressure (CPU available capacity from `pmset -g therm`)
    pub thermal_pressure: Option<String>,
    // Misc
    pub uptime_secs: u64,
    pub host_name: String,
    pub os_version: String,
    pub model: String,
}

pub fn collect() -> Stats {
    let (load_1m, load_5m, load_15m) = load_avg();
    let cpu_count = sysctl_u64("hw.ncpu").unwrap_or(0) as usize;
    let cpu_brand = sysctl_str("machdep.cpu.brand_string").unwrap_or_default();
    let mem_total = sysctl_u64("hw.memsize").unwrap_or(0);
    let mem_used = mem_used_bytes(mem_total);
    let mem_pressure = mem_pressure_label();
    let (disk_total, disk_used, disk_path) = disk_root();
    let (battery_percent, battery_state, battery_time_remaining) = battery();
    let thermal_pressure = thermal_pressure();
    let uptime_secs = uptime_secs();
    let host_name = hostname();
    let os_version = os_version();
    let model = sysctl_str("hw.model").unwrap_or_default();

    Stats {
        load_1m,
        load_5m,
        load_15m,
        cpu_count,
        cpu_brand,
        mem_total,
        mem_used,
        mem_pressure,
        disk_total,
        disk_used,
        disk_path,
        battery_percent,
        battery_state,
        battery_time_remaining,
        thermal_pressure,
        uptime_secs,
        host_name,
        os_version,
        model,
    }
}

// ---------- CPU ----------

fn load_avg() -> (f64, f64, f64) {
    // `sysctl -n vm.loadavg` returns: "{ 1.85 2.12 1.98 }"
    let out = run("sysctl", &["-n", "vm.loadavg"]);
    let trimmed = out.trim().trim_start_matches('{').trim_end_matches('}');
    let parts: Vec<f64> = trimmed
        .split_whitespace()
        .filter_map(|s| s.parse::<f64>().ok())
        .collect();
    match parts.as_slice() {
        [a, b, c, ..] => (*a, *b, *c),
        _ => (0.0, 0.0, 0.0),
    }
}

// ---------- Memory ----------

fn mem_used_bytes(total: u64) -> u64 {
    // vm_stat reports pages. Used = wired + active + compressed (rough
    // but close to the Activity Monitor "Memory Used" line). Page size
    // is 16 KiB on Apple Silicon, 4 KiB on Intel — read it from the
    // header line so we don't bake an assumption in.
    let out = run("vm_stat", &[]);
    let mut page_size: u64 = 4096;
    let mut wired: u64 = 0;
    let mut active: u64 = 0;
    let mut compressed: u64 = 0;
    for line in out.lines() {
        if line.starts_with("Mach Virtual Memory Statistics") {
            // page size of 16384 bytes
            if let Some(rest) = line.split("page size of").nth(1) {
                if let Some(num) = rest.split_whitespace().next() {
                    if let Ok(n) = num.parse::<u64>() {
                        page_size = n;
                    }
                }
            }
        } else if let Some(val) = line.strip_prefix("Pages wired down:") {
            wired = parse_pages(val);
        } else if let Some(val) = line.strip_prefix("Pages active:") {
            active = parse_pages(val);
        } else if let Some(val) = line.strip_prefix("Pages occupied by compressor:") {
            compressed = parse_pages(val);
        }
    }
    let used = (wired + active + compressed).saturating_mul(page_size);
    used.min(total)
}

fn parse_pages(s: &str) -> u64 {
    s.trim()
        .trim_end_matches('.')
        .replace(',', "")
        .parse::<u64>()
        .unwrap_or(0)
}

fn mem_pressure_label() -> Option<String> {
    // `memory_pressure` exists on macOS but its CLI output isn't
    // structured. The `kern.memorystatus_level` sysctl returns a 0-100
    // value where lower = more pressure. Map to coarse buckets.
    let level = sysctl_u64("kern.memorystatus_level")?;
    Some(match level {
        80..=100 => "Normal".into(),
        50..=79 => "Warning".into(),
        _ => "Critical".into(),
    })
}

// ---------- Disk ----------

fn disk_root() -> (u64, u64, String) {
    // `df -k /` → Filesystem 1024-blocks Used Available Capacity ...
    let out = run("df", &["-k", "/"]);
    let mut total: u64 = 0;
    let mut used: u64 = 0;
    let mut path = "/".to_string();
    if let Some(line) = out.lines().nth(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() >= 9 {
            let kb_total: u64 = cols[1].parse().unwrap_or(0);
            let kb_used: u64 = cols[2].parse().unwrap_or(0);
            total = kb_total * 1024;
            used = kb_used * 1024;
            // The mount point is the last column (may contain spaces in
            // exotic setups; / is fine).
            path = cols[cols.len() - 1].to_string();
        }
    }
    (total, used, path)
}

// ---------- Battery ----------

fn battery() -> (Option<u32>, Option<String>, Option<String>) {
    let out = run("pmset", &["-g", "batt"]);
    // Sample: "  -InternalBattery-0 (id=0)\t87%; discharging; 4:23 remaining present: true"
    let line = match out.lines().find(|l| l.contains("InternalBattery")) {
        Some(l) => l,
        None => return (None, None, None),
    };
    let percent = line.split('\t').nth(1).and_then(|s| {
        s.split('%').next().and_then(|p| p.trim().parse::<u32>().ok())
    });
    let parts: Vec<&str> = line.split(';').collect();
    let state = parts
        .get(1)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    // "4:23 remaining present: true" → "4:23 remaining"
    let time = parts.get(2).and_then(|s| {
        let s = s.trim();
        if s.contains("remaining") {
            Some(
                s.split("present").next().unwrap_or(s).trim().to_string(),
            )
        } else if s.contains("not charging") || s.contains("charged") {
            None
        } else {
            None
        }
    });
    (percent, state, time)
}

// ---------- Thermal pressure ----------

fn thermal_pressure() -> Option<String> {
    // `pmset -g therm` lines like:
    //   CPU_Scheduler_Limit  = 100
    //   CPU_Available_CPUs   = 10
    //   CPU_Speed_Limit      = 100
    let out = run("pmset", &["-g", "therm"]);
    let mut limit: Option<u32> = None;
    let mut speed_limit: Option<u32> = None;
    for line in out.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("CPU_Scheduler_Limit") {
            limit = parse_kv_u32(rest);
        } else if let Some(rest) = l.strip_prefix("CPU_Speed_Limit") {
            speed_limit = parse_kv_u32(rest);
        }
    }
    let l = limit.unwrap_or(100);
    let s = speed_limit.unwrap_or(100);
    let throttled = l < 100 || s < 100;
    if throttled {
        Some(format!("Throttled (limit {l}%, speed {s}%)"))
    } else {
        Some("Nominal".into())
    }
}

fn parse_kv_u32(s: &str) -> Option<u32> {
    s.split('=').nth(1)?.trim().parse().ok()
}

// ---------- Uptime / hostname / os ----------

fn uptime_secs() -> u64 {
    // sysctl -n kern.boottime → "{ sec = 1745849221, usec = 393301 } Wed Apr 28 ..."
    let out = run("sysctl", &["-n", "kern.boottime"]);
    let sec = out
        .split("sec = ")
        .nth(1)
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse::<u64>().ok());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    sec.map(|s| now.saturating_sub(s)).unwrap_or(0)
}

fn hostname() -> String {
    run("hostname", &["-s"]).trim().to_string()
}

fn os_version() -> String {
    let name = run("sw_vers", &["-productName"]).trim().to_string();
    let ver = run("sw_vers", &["-productVersion"]).trim().to_string();
    if name.is_empty() {
        ver
    } else {
        format!("{name} {ver}")
    }
}

// ---------- helpers ----------

fn run(cmd: &str, args: &[&str]) -> String {
    let mut c = Command::new(cmd);
    c.args(args);
    // The Stats view auto-refreshes every 2s; cap each probe so a wedged
    // sysctl/vm_stat/df/pmset can't pile up and stall the refresh.
    crate::proc::capture_stdout(c, std::time::Duration::from_secs(3))
        .and_then(|o| String::from_utf8(o).ok())
        .unwrap_or_default()
}

fn sysctl_u64(key: &str) -> Option<u64> {
    run("sysctl", &["-n", key]).trim().parse().ok()
}

fn sysctl_str(key: &str) -> Option<String> {
    let s = run("sysctl", &["-n", key]).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pages_strips_dot_and_commas() {
        assert_eq!(parse_pages("  12,345."), 12345);
        assert_eq!(parse_pages(" 0."), 0);
    }

    #[test]
    fn parse_kv_extracts_number() {
        assert_eq!(parse_kv_u32("CPU_Scheduler_Limit = 75"), Some(75));
        assert_eq!(parse_kv_u32(" = 100"), Some(100));
        assert_eq!(parse_kv_u32("garbage"), None);
    }

    #[test]
    fn collect_returns_plausible_values() {
        // Smoke test — runs the real shell-outs. Should produce
        // non-zero CPU count and a populated host_name on any mac.
        let s = collect();
        assert!(s.cpu_count > 0, "cpu_count should be > 0");
        assert!(s.mem_total > 0, "mem_total should be > 0");
        assert!(!s.host_name.is_empty(), "host_name should be set");
    }
}
