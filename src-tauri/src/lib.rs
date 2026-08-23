mod desktop_runtime;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

static TERMINAL_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const MAX_PI_PACKAGE_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_PI_PACKAGE_SOURCE_BYTES: usize = 512;
const MAX_PI_THEME_BYTES: u64 = 256 * 1024;
const PI_PACKAGE_TIMEOUT: Duration = Duration::from_secs(120);
const PI_GUI_DATA_DIR_ENV: &str = "PI_GUI_DATA_DIR";

fn validate_app_data_override(
    value: Option<std::ffi::OsString>,
) -> Result<Option<PathBuf>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_empty() {
        return Err(format!("{PI_GUI_DATA_DIR_ENV} cannot be empty"));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() || path.parent().is_none() {
        return Err(format!(
            "{PI_GUI_DATA_DIR_ENV} must be an absolute, non-root directory"
        ));
    }
    Ok(Some(path))
}

pub(crate) fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = validate_app_data_override(std::env::var_os(PI_GUI_DATA_DIR_ENV))? {
        return Ok(path);
    }
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve the desktop app data directory: {error}"))
}

#[cfg(target_os = "windows")]
fn terminate_windows_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill.exe")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .status();
}

#[derive(Default)]
struct RpcProcessHandle {
    generation: u64,
    process: Option<Child>,
    stdin_writer: Option<std::process::ChildStdin>,
}

/// State for managing multiple RPC child processes (one per instance)
pub struct RpcState {
    instances: Arc<Mutex<HashMap<String, RpcProcessHandle>>>,
}

impl Default for RpcState {
    fn default() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Drop for RpcState {
    fn drop(&mut self) {
        if let Ok(mut instances) = self.instances.lock() {
            for (_, mut handle) in instances.drain() {
                stop_rpc_instance(&mut handle);
            }
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct RpcLineEventPayload {
    instance_id: String,
    generation: u64,
    line: String,
}

#[derive(Debug, Serialize, Clone)]
struct RpcClosedEventPayload {
    instance_id: String,
    generation: u64,
    reason: String,
}

#[derive(Debug, Serialize)]
struct RpcStartResult {
    discovery: String,
    generation: u64,
}

fn normalize_instance_id(instance_id: Option<String>) -> String {
    let raw = instance_id.unwrap_or_else(|| "default".to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_string()
    }
}

fn stop_rpc_instance(handle: &mut RpcProcessHandle) {
    handle.stdin_writer = None;
    if let Some(mut child) = handle.process.take() {
        #[cfg(target_os = "windows")]
        {
            // npm/Volta .cmd shims create descendants that survive killing only
            // the process represented by std::process::Child. Terminate the exact
            // owned PID tree so credentials and RPC workers cannot outlive Tauri.
            terminate_windows_process_tree(child.id());
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn active_rpc_count(state: &RpcState) -> Result<usize, String> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|_| "Failed to acquire RPC instances lock".to_string())?;
    let mut active = 0;
    for handle in instances.values_mut() {
        let running = match handle.process.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) | Err(_) => false,
            },
            None => false,
        };
        if running {
            active += 1;
        } else {
            handle.process = None;
            handle.stdin_writer = None;
        }
    }
    Ok(active)
}

struct TerminalProcessHandle {
    pid: Option<u32>,
    writer: Option<Box<dyn Write + Send>>,
    master: Option<Box<dyn MasterPty + Send>>,
    killer: Option<Box<dyn ChildKiller + Send + Sync>>,
}

pub struct TerminalState {
    instances: Arc<Mutex<HashMap<String, TerminalProcessHandle>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn stop_terminal_instance(handle: &mut TerminalProcessHandle) {
    handle.writer = None;
    #[cfg(target_os = "windows")]
    if let Some(pid) = handle.pid {
        terminate_windows_process_tree(pid);
    }
    if let Some(mut killer) = handle.killer.take() {
        let _ = killer.kill();
    }
    handle.master = None;
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        if let Ok(mut instances) = self.instances.lock() {
            for (_, mut handle) in instances.drain() {
                stop_terminal_instance(&mut handle);
            }
        }
    }
}

pub struct PiPackageState {
    operation: tokio::sync::Mutex<()>,
    active_child: Arc<Mutex<Option<Child>>>,
}

impl Default for PiPackageState {
    fn default() -> Self {
        Self {
            operation: tokio::sync::Mutex::new(()),
            active_child: Arc::new(Mutex::new(None)),
        }
    }
}

fn stop_pi_package_process(child: &mut Child) {
    #[cfg(target_os = "windows")]
    terminate_windows_process_tree(child.id());
    let _ = child.kill();
    let _ = child.wait();
}

fn stop_pi_package_child(active_child: &Arc<Mutex<Option<Child>>>) {
    if let Ok(mut active) = active_child.lock() {
        if let Some(mut child) = active.take() {
            stop_pi_package_process(&mut child);
        }
    }
}

impl Drop for PiPackageState {
    fn drop(&mut self) {
        stop_pi_package_child(&self.active_child);
    }
}

#[derive(Debug, Serialize, Clone)]
struct TerminalOutputEventPayload {
    terminal_id: String,
    data: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
struct TerminalExitEventPayload {
    terminal_id: String,
    exit_code: Option<u32>,
    reason: String,
}

#[derive(Debug, Serialize)]
struct TerminalStartResult {
    terminal_id: String,
    shell: String,
    pid: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct RpcStartOptions {
    cwd: String,
    provider: Option<String>,
    model: Option<String>,
}

/// How the pi process was resolved
#[derive(Debug, Clone)]
enum PiProcess {
    /// Versioned standalone binary owned by Pi GUI.
    ManagedBinary { path: PathBuf, version: String },
    /// Packaged sidecar binary bundled with the desktop app
    SidecarBinary { path: PathBuf },
    /// Production/dev fallback: standalone pi binary found on PATH
    PathBinary { path: PathBuf },
}

fn find_sidecar_in_dir(dir: &Path, expected_name: &str) -> Option<PathBuf> {
    let exact = dir.join(expected_name);
    if exact.is_file() {
        return Some(exact);
    }

    None
}

fn discover_sidecar(app: &AppHandle) -> Option<PathBuf> {
    let default_target = if cfg!(target_os = "windows") {
        format!("{}-pc-windows-msvc", std::env::consts::ARCH)
    } else if cfg!(target_os = "macos") {
        format!("{}-apple-darwin", std::env::consts::ARCH)
    } else if cfg!(target_os = "linux") {
        format!("{}-unknown-linux-gnu", std::env::consts::ARCH)
    } else {
        format!(
            "{}-unknown-{}",
            std::env::consts::ARCH,
            std::env::consts::OS
        )
    };

    let target = std::env::var("TARGET").unwrap_or(default_target);

    let extension = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let expected_name = format!("pi-{}{}", target, extension);

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidate_dirs.push(resource_dir.clone());
        candidate_dirs.push(resource_dir.join("binaries"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidate_dirs.push(parent.to_path_buf());
            candidate_dirs.push(parent.join("binaries"));
            candidate_dirs.push(parent.join(".."));
            candidate_dirs.push(parent.join("..").join("Resources"));
            candidate_dirs.push(parent.join("..").join("Resources").join("binaries"));
        }
    }

    for dir in candidate_dirs {
        if !dir.exists() || !dir.is_dir() {
            continue;
        }
        if let Some(found) = find_sidecar_in_dir(&dir, &expected_name) {
            return Some(found);
        }
    }

    None
}

fn resolve_home_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        if !user_profile.trim().is_empty() {
            return Some(PathBuf::from(user_profile));
        }
    }
    None
}

fn expand_tilde_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        if let Some(home) = resolve_home_dir() {
            return home;
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = resolve_home_dir() {
            return home.join(rest);
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~\\") {
        if let Some(home) = resolve_home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn resolve_explicit_pi_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let expanded = expand_tilde_path(trimmed);
    if expanded.is_file() {
        return Some(expanded);
    }

    if let Ok(which_path) = which::which(trimmed) {
        return Some(which_path);
    }

    None
}

fn discover_pi_from_common_locations() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if cfg!(target_os = "windows") {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let app_data_dir = PathBuf::from(app_data);
            candidates.push(app_data_dir.join("npm").join("pi.cmd"));
            candidates.push(app_data_dir.join("npm").join("pi.exe"));
            candidates.push(app_data_dir.join("npm").join("pi.bat"));
            candidates.push(app_data_dir.join("npm").join("pi"));
        }

        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let local_app_data_dir = PathBuf::from(local_app_data);
            candidates.push(local_app_data_dir.join("npm").join("pi.cmd"));
            candidates.push(local_app_data_dir.join("npm").join("pi.exe"));
        }

        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let user_dir = PathBuf::from(user_profile);
            candidates.push(
                user_dir
                    .join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .join("pi.cmd"),
            );
            candidates.push(
                user_dir
                    .join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .join("pi.exe"),
            );
            candidates.push(user_dir.join("scoop").join("shims").join("pi.cmd"));
        }

        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("nodejs").join("pi.cmd"));
        }

        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(
                PathBuf::from(program_files_x86)
                    .join("nodejs")
                    .join("pi.cmd"),
            );
        }

        if let Ok(program_data) = std::env::var("ProgramData") {
            let program_data_dir = PathBuf::from(program_data);
            candidates.push(program_data_dir.join("npm").join("pi.cmd"));
            candidates.push(program_data_dir.join("npm").join("pi.exe"));
        }

        if let Ok(nvm_home) = std::env::var("NVM_HOME") {
            candidates.push(PathBuf::from(nvm_home).join("pi.cmd"));
        }

        if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
            candidates.push(PathBuf::from(nvm_symlink).join("pi.cmd"));
        }

        return candidates.into_iter().find(|candidate| candidate.is_file());
    }

    if let Some(home_dir) = resolve_home_dir() {
        // nvm installations (common for npm global installs)
        candidates.push(home_dir.join(".nvm/versions/node/current/bin/pi"));
        let nvm_versions_dir = home_dir.join(".nvm/versions/node");
        if let Ok(entries) = fs::read_dir(nvm_versions_dir) {
            let mut version_dirs: Vec<PathBuf> = entries
                .filter_map(|entry| {
                    let path = entry.ok()?.path();
                    if path.is_dir() {
                        Some(path)
                    } else {
                        None
                    }
                })
                .collect();
            version_dirs.sort_by(|a, b| b.cmp(a));
            for version_dir in version_dirs {
                candidates.push(version_dir.join("bin/pi"));
            }
        }

        // Other common per-user install locations
        candidates.push(home_dir.join(".pi/agent/bin/pi"));
        candidates.push(home_dir.join(".volta/bin/pi"));
        candidates.push(home_dir.join(".local/bin/pi"));
        candidates.push(home_dir.join(".npm-global/bin/pi"));
        candidates.push(home_dir.join(".npm/bin/pi"));
    }

    // npm custom prefix installs (common on Linux/macOS desktop launches)
    for key in ["NPM_CONFIG_PREFIX", "PREFIX"] {
        if let Ok(prefix) = std::env::var(key) {
            let trimmed = prefix.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed).join("bin/pi"));
                candidates.push(PathBuf::from(trimmed).join("pi"));
            }
        }
    }

    // Common system install locations
    candidates.push(PathBuf::from("/opt/homebrew/bin/pi"));
    candidates.push(PathBuf::from("/usr/local/bin/pi"));
    candidates.push(PathBuf::from("/usr/bin/pi"));

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn prepend_bin_dir_to_path(cmd: &mut Command, bin_dir: &Path) {
    let mut path_entries = vec![bin_dir.to_path_buf()];
    if let Some(existing) = std::env::var_os("PATH") {
        path_entries.extend(std::env::split_paths(&existing));
    }

    if let Ok(joined) = std::env::join_paths(path_entries) {
        cmd.env("PATH", joined);
    }
}

fn discover_pi_from_env_override() -> Option<PathBuf> {
    for key in ["PI_DESKTOP_PI_PATH", "PI_CLI_PATH"] {
        if let Ok(raw) = std::env::var(key) {
            if let Some(path) = resolve_explicit_pi_path(&raw) {
                return Some(path);
            }
        }
    }
    None
}

fn missing_pi_cli_error(additional: Option<String>) -> String {
    let mut message = String::from(
        "Pi is not available. Open the Pi Runtime panel to install the managed runtime, or choose Advanced > Use system Pi.",
    );
    if let Some(extra) = additional {
        let trimmed = extra.trim();
        if !trimmed.is_empty() {
            message.push_str("\n\n");
            message.push_str(trimmed);
        }
    }
    message
}

fn discover_system_pi(
    settings: &desktop_runtime::RuntimeSettings,
) -> Result<Option<PiProcess>, String> {
    if let Some(configured) = settings.system_pi_path.as_deref() {
        if let Some(path) = resolve_explicit_pi_path(configured) {
            return Ok(Some(PiProcess::PathBinary { path }));
        }
        return Err(missing_pi_cli_error(Some(format!(
            "Configured system Pi path was not found: {configured}"
        ))));
    }
    if let Some(path) = discover_pi_from_env_override() {
        return Ok(Some(PiProcess::PathBinary { path }));
    }
    if let Ok(path) = which::which("pi") {
        return Ok(Some(PiProcess::PathBinary { path }));
    }
    if let Some(path) = discover_pi_from_common_locations() {
        return Ok(Some(PiProcess::PathBinary { path }));
    }
    Ok(None)
}

/// Resolve the native runtime preference. Managed mode uses a versioned desktop-owned
/// binary first, then a packaged sidecar, and only then a system fallback. System mode
/// never mutates or wraps the user's installation.
fn discover_pi(app: &AppHandle) -> Result<PiProcess, String> {
    let settings = desktop_runtime::load_settings(app)?;
    if settings.mode == desktop_runtime::RuntimeMode::Managed {
        if let Some(managed) = desktop_runtime::resolve_managed_runtime(app)? {
            return Ok(PiProcess::ManagedBinary {
                path: managed.executable,
                version: managed.version,
            });
        }
        if let Some(path) = discover_sidecar(app) {
            return Ok(PiProcess::SidecarBinary { path });
        }
    }

    if let Some(system) = discover_system_pi(&settings)? {
        return Ok(system);
    }

    Err(missing_pi_cli_error(None))
}

fn pi_discovery_label(pi: &PiProcess) -> String {
    match pi {
        PiProcess::ManagedBinary { version, .. } => format!("Managed Pi {version}"),
        PiProcess::SidecarBinary { .. } => "Bundled Pi runtime".to_string(),
        PiProcess::PathBinary { path } => {
            format!("System Pi · {}", path.to_string_lossy())
        }
    }
}

/// Build a Command for the discovered pi process
fn build_command(pi: &PiProcess, options: &RpcStartOptions) -> Command {
    let mut cmd = match pi {
        PiProcess::ManagedBinary { path, .. }
        | PiProcess::SidecarBinary { path }
        | PiProcess::PathBinary { path } => Command::new(path),
    };

    cmd.arg("--mode").arg("rpc");

    if let Some(ref provider) = options.provider {
        cmd.arg("--provider").arg(provider);
    }
    if let Some(ref model) = options.model {
        cmd.arg("--model").arg(model);
    }

    cmd.current_dir(&options.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // If using a script-based pi binary (e.g. npm global install), ensure its bin dir
    // is on PATH so shebangs like `#!/usr/bin/env node` can resolve node in GUI launches.
    if let PiProcess::PathBinary { path } = pi {
        if let Some(parent) = path.parent() {
            prepend_bin_dir_to_path(&mut cmd, parent);
        }
    }

    // On Windows, prevent console window from appearing
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd
}

fn write_rpc_line(stdin: &mut std::process::ChildStdin, line: &str) -> Result<(), String> {
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("Failed to write to stdin: {}", e))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("Failed to write newline: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("Failed to flush stdin: {}", e))?;
    Ok(())
}

/// Start the pi coding agent in RPC mode as a child process.
/// Runtime selection comes only from native Desktop settings.
#[tauri::command]
async fn rpc_start(
    app: AppHandle,
    state: tauri::State<'_, RpcState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
    options: RpcStartOptions,
    instance_id: Option<String>,
) -> Result<RpcStartResult, String> {
    if runtime_state.is_operation_active() {
        return Err("Pi runtime maintenance is in progress; retry when it completes".to_string());
    }
    let instance_id = normalize_instance_id(instance_id);

    let generation = if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            let next_generation = handle.generation.saturating_add(1).max(1);
            stop_rpc_instance(handle);
            next_generation
        } else {
            1
        }
    } else {
        return Err("Failed to acquire RPC instances lock".to_string());
    };

    let cwd_path = Path::new(&options.cwd);
    if !cwd_path.is_dir() {
        return Err(format!("Working directory does not exist: {}", options.cwd));
    }

    let pi = discover_pi(&app)?;
    let discovery_label = pi_discovery_label(&pi);

    let mut cmd = build_command(&pi, &options);
    let mut child = cmd.spawn().map_err(|e| {
        let lower = e.to_string().to_lowercase();
        let missing_executable = matches!(e.raw_os_error(), Some(2) | Some(3))
            || e.kind() == std::io::ErrorKind::NotFound
            || (lower.contains("createprocess") && lower.contains("cannot find"));
        if missing_executable {
            return missing_pi_cli_error(Some(format!(
                "Discovery details: {:?}\nSpawn error: {}",
                pi, e
            )));
        }
        format!("Failed to spawn pi process ({:?}): {}", pi, e)
    })?;

    if runtime_state.is_operation_active() {
        #[cfg(target_os = "windows")]
        terminate_windows_process_tree(child.id());
        let _ = child.kill();
        let _ = child.wait();
        return Err("Pi runtime maintenance started during RPC launch; retry later".to_string());
    }

    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            #[cfg(target_os = "windows")]
            terminate_windows_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to get Pi RPC stdin".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            #[cfg(target_os = "windows")]
            terminate_windows_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to get Pi RPC stdout".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            #[cfg(target_os = "windows")]
            terminate_windows_process_tree(child.id());
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to get Pi RPC stderr".to_string());
        }
    };

    // Store process + stdin handle for this instance
    if let Ok(mut instances) = state.instances.lock() {
        instances.insert(
            instance_id.clone(),
            RpcProcessHandle {
                generation,
                process: Some(child),
                stdin_writer: Some(stdin),
            },
        );
    } else {
        #[cfg(target_os = "windows")]
        terminate_windows_process_tree(child.id());
        let _ = child.kill();
        let _ = child.wait();
        return Err("Failed to acquire RPC instances lock".to_string());
    }
    runtime_state.logger().record(
        "info",
        "rpc_started",
        &format!("{} via {}", instance_id, discovery_label),
    );

    // Spawn thread to read stdout and emit events to frontend
    let app_handle = app.clone();
    let stdout_instance_id = instance_id.clone();
    let stdout_generation = generation;
    let runtime_logger = runtime_state.logger();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let payload = RpcLineEventPayload {
                        instance_id: stdout_instance_id.clone(),
                        generation: stdout_generation,
                        line,
                    };
                    let _ = app_handle.emit("rpc-event", payload);
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(
            "rpc-closed",
            RpcClosedEventPayload {
                instance_id: stdout_instance_id.clone(),
                generation: stdout_generation,
                reason: "process exited".to_string(),
            },
        );
        runtime_logger.record(
            "info",
            "rpc_exited",
            &format!("{} generation {}", stdout_instance_id, stdout_generation),
        );
    });

    // Spawn thread to read stderr
    let app_handle_err = app.clone();
    let stderr_instance_id = instance_id.clone();
    let stderr_generation = generation;
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    let payload = RpcLineEventPayload {
                        instance_id: stderr_instance_id.clone(),
                        generation: stderr_generation,
                        line,
                    };
                    let _ = app_handle_err.emit("rpc-stderr", payload);
                }
                Err(_) => break,
            }
        }
    });

    Ok(RpcStartResult {
        discovery: format!("{} [instance:{}]", discovery_label, instance_id),
        generation,
    })
}

/// Send a JSON command to an RPC process stdin
#[tauri::command]
async fn rpc_send(
    state: tauri::State<'_, RpcState>,
    command: String,
    instance_id: Option<String>,
) -> Result<(), String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            if let Some(ref mut stdin) = handle.stdin_writer {
                write_rpc_line(stdin, &command)
            } else {
                Err(format!(
                    "RPC process not started for instance '{}'",
                    instance_id
                ))
            }
        } else {
            Err(format!(
                "RPC process not started for instance '{}'",
                instance_id
            ))
        }
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Stop an RPC process instance
#[tauri::command]
async fn rpc_stop(
    state: tauri::State<'_, RpcState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
    instance_id: Option<String>,
) -> Result<(), String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(mut handle) = instances.remove(&instance_id) {
            stop_rpc_instance(&mut handle);
            runtime_state
                .logger()
                .record("info", "rpc_stopped", &instance_id);
        }
        Ok(())
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Stop all RPC process instances
#[tauri::command]
async fn rpc_stop_all(
    state: tauri::State<'_, RpcState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
) -> Result<(), String> {
    if let Ok(mut instances) = state.instances.lock() {
        for (_, mut handle) in instances.drain() {
            stop_rpc_instance(&mut handle);
        }
        runtime_state
            .logger()
            .record("info", "rpc_stopped_all", "Stopped all Pi RPC processes");
        Ok(())
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Check if an RPC process instance is running
#[tauri::command]
async fn rpc_is_running(
    state: tauri::State<'_, RpcState>,
    instance_id: Option<String>,
) -> Result<bool, String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            if let Some(ref mut child) = handle.process {
                match child.try_wait() {
                    Ok(None) => Ok(true),
                    Ok(Some(_)) => {
                        handle.process = None;
                        handle.stdin_writer = None;
                        Ok(false)
                    }
                    Err(_) => Ok(false),
                }
            } else {
                Ok(false)
            }
        } else {
            Ok(false)
        }
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Send a response to an extension UI dialog request
#[tauri::command]
async fn rpc_ui_response(
    state: tauri::State<'_, RpcState>,
    response: String,
    instance_id: Option<String>,
) -> Result<(), String> {
    let instance_id = normalize_instance_id(instance_id);
    if let Ok(mut instances) = state.instances.lock() {
        if let Some(handle) = instances.get_mut(&instance_id) {
            if let Some(ref mut stdin) = handle.stdin_writer {
                write_rpc_line(stdin, &response)
            } else {
                Err(format!(
                    "RPC process not started for instance '{}'",
                    instance_id
                ))
            }
        } else {
            Err(format!(
                "RPC process not started for instance '{}'",
                instance_id
            ))
        }
    } else {
        Err("Failed to acquire RPC instances lock".to_string())
    }
}

/// Session info for listing
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub name: Option<String>,
    pub path: String,
    pub cwd: Option<String>,
    pub created_at: i64,
    pub modified_at: i64,
    pub tokens: u64,
    pub cost: f64,
}

fn get_pi_agent_dir() -> Option<PathBuf> {
    // Respect explicit env override first
    if let Ok(raw) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            if trimmed == "~" {
                return std::env::var_os("HOME")
                    .or(std::env::var_os("USERPROFILE"))
                    .map(PathBuf::from);
            }
            if let Some(rest) = trimmed
                .strip_prefix("~/")
                .or_else(|| trimmed.strip_prefix("~\\"))
            {
                return std::env::var_os("HOME")
                    .or(std::env::var_os("USERPROFILE"))
                    .map(|home| PathBuf::from(home).join(rest));
            }
            return Some(PathBuf::from(trimmed));
        }
    }

    // Default: ~/.pi/agent
    std::env::var_os("HOME")
        .or(std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".pi").join("agent"))
}

fn get_pi_sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(agent_dir) = get_pi_agent_dir() {
        return Ok(agent_dir.join("sessions"));
    }

    // Fallback for unusual environments
    let data_dir = app_data_root(app)?;
    Ok(data_dir.join("sessions"))
}

fn collect_session_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_session_files_recursive(&path, out);
            continue;
        }

        let is_jsonl = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false);

        if is_jsonl {
            out.push(path);
        }
    }
}

fn get_modified_at_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn get_created_at_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.created().ok())
        .or_else(|| fs::metadata(path).ok().and_then(|m| m.modified().ok()))
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_session_info(path: &Path) -> Option<SessionInfo> {
    let content = fs::read_to_string(path).ok()?;

    let mut id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let mut name: Option<String> = None;
    let mut cwd: Option<String> = None;
    let mut tokens: u64 = 0;
    let mut cost: f64 = 0.0;

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let entry = match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match entry.get("type").and_then(|t| t.as_str()) {
            Some("session") => {
                if let Some(session_id) = entry.get("id").and_then(|v| v.as_str()) {
                    id = session_id.to_string();
                }
                if let Some(session_cwd) = entry.get("cwd").and_then(|v| v.as_str()) {
                    let trimmed = session_cwd.trim();
                    if !trimmed.is_empty() {
                        cwd = Some(trimmed.to_string());
                    }
                }
            }
            Some("session_info") => {
                if let Some(session_name) = entry.get("name").and_then(|v| v.as_str()) {
                    let trimmed = session_name.trim();
                    if !trimmed.is_empty() {
                        name = Some(trimmed.to_string());
                    }
                }
            }
            Some("message") => {
                let message = entry.get("message");
                let role = message.and_then(|m| m.get("role")).and_then(|r| r.as_str());
                if role == Some("assistant") {
                    let message_tokens = message
                        .and_then(|m| m.get("usage"))
                        .and_then(|u| u.get("totalTokens"))
                        .and_then(|t| t.as_u64())
                        .unwrap_or(0);
                    tokens = tokens.saturating_add(message_tokens);

                    let message_cost = message
                        .and_then(|m| m.get("usage"))
                        .and_then(|u| u.get("cost"))
                        .and_then(|c| c.get("total"))
                        .and_then(|c| c.as_f64())
                        .unwrap_or(0.0);
                    cost += message_cost;
                }
            }
            _ => {}
        }
    }

    Some(SessionInfo {
        id,
        name,
        path: path.to_string_lossy().to_string(),
        cwd,
        created_at: get_created_at_ms(path),
        modified_at: get_modified_at_ms(path),
        tokens,
        cost,
    })
}

/// List all sessions from pi's session directory (~/.pi/agent/sessions)
#[tauri::command]
async fn list_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let sessions_dir = get_pi_sessions_dir(&app)?;

    if !sessions_dir.exists() {
        fs::create_dir_all(&sessions_dir)
            .map_err(|e| format!("Failed to create sessions dir: {}", e))?;
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    collect_session_files_recursive(&sessions_dir, &mut files);

    let mut sessions = files
        .iter()
        .filter_map(|path| parse_session_info(path))
        .collect::<Vec<_>>();

    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

fn resolve_session_file(sessions_dir: &Path, requested: &Path) -> Result<Option<PathBuf>, String> {
    if !sessions_dir.exists() {
        return Ok(None);
    }

    if requested.as_os_str().is_empty() || !requested.exists() {
        return Ok(None);
    }

    let sessions_root = fs::canonicalize(&sessions_dir)
        .map_err(|e| format!("Failed to resolve sessions directory: {}", e))?;
    let target = fs::canonicalize(&requested)
        .map_err(|e| format!("Failed to resolve session path: {}", e))?;
    let is_jsonl = target
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(false);

    if !target.starts_with(&sessions_root) || !target.is_file() || !is_jsonl {
        return Err("Refusing to access a file outside the Pi sessions directory".to_string());
    }

    Ok(Some(target))
}

/// Delete one persisted Pi session without exposing a general-purpose file delete command.
fn delete_session_file(sessions_dir: &Path, requested: &Path) -> Result<bool, String> {
    let Some(target) = resolve_session_file(sessions_dir, requested)? else {
        return Ok(false);
    };

    fs::remove_file(&target).map_err(|e| format!("Failed to delete session: {}", e))?;
    Ok(true)
}

fn read_session_file(sessions_dir: &Path, requested: &Path) -> Result<String, String> {
    let target = resolve_session_file(sessions_dir, requested)?
        .ok_or_else(|| "Session file does not exist".to_string())?;
    fs::read_to_string(&target).map_err(|e| format!("Failed to read session: {}", e))
}

#[tauri::command]
async fn delete_session(app: AppHandle, session_path: String) -> Result<bool, String> {
    let sessions_dir = get_pi_sessions_dir(&app)?;
    let requested = PathBuf::from(session_path.trim());
    delete_session_file(&sessions_dir, &requested)
}

/// Get the content of a session file
#[tauri::command]
async fn get_session_content(app: AppHandle, session_path: String) -> Result<String, String> {
    let sessions_dir = get_pi_sessions_dir(&app)?;
    let requested = PathBuf::from(session_path.trim());
    read_session_file(&sessions_dir, &requested)
}

const MAX_WORKSPACE_FILE_BYTES: u64 = 1024 * 1024;
const MAX_WORKSPACE_DIRECTORY_ENTRIES: usize = 2_000;
const MAX_WORKSPACE_INDEX_ENTRIES: usize = 5_000;
const MAX_WORKSPACE_INDEX_DEPTH: usize = 8;

#[derive(Debug, Serialize)]
struct WorkspaceEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified_at: u64,
}

#[derive(Debug, Serialize)]
struct WorkspaceDirectory {
    path: String,
    entries: Vec<WorkspaceEntry>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
struct WorkspaceFileIndex {
    files: Vec<String>,
    truncated: bool,
}

#[derive(Debug, Serialize)]
struct WorkspaceTextFile {
    path: String,
    content: String,
    size: u64,
    modified_at: u64,
}

fn workspace_relative_path(raw: &str, allow_empty: bool) -> Result<PathBuf, String> {
    if raw.contains('\0') {
        return Err("Workspace paths cannot contain NUL characters".to_string());
    }
    if raw.is_empty() {
        return if allow_empty {
            Ok(PathBuf::new())
        } else {
            Err("Choose a workspace file first".to_string())
        };
    }

    let path = PathBuf::from(raw);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(
            "Workspace file paths must stay relative to the selected workspace".to_string(),
        );
    }
    Ok(path)
}

fn canonical_workspace_root(workspace_root: &str) -> Result<PathBuf, String> {
    let requested = workspace_root.trim();
    if requested.is_empty() {
        return Err("Choose a workspace first".to_string());
    }
    let root = fs::canonicalize(requested)
        .map_err(|e| format!("Could not resolve the selected workspace: {}", e))?;
    if !root.is_dir() {
        return Err("The selected workspace is not a directory".to_string());
    }
    Ok(root)
}

fn external_command_path(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let raw = path.to_string_lossy();
        if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", rest));
        }
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn ensure_inside_workspace(root: &Path, target: PathBuf) -> Result<PathBuf, String> {
    let resolved = fs::canonicalize(&target)
        .map_err(|e| format!("Could not resolve workspace path: {}", e))?;
    if !resolved.starts_with(root) {
        return Err("Refusing to access a path outside the selected workspace".to_string());
    }
    Ok(resolved)
}

fn path_to_workspace_string(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => parts.push(value.to_str()?.to_string()),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

fn workspace_modified_at(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn is_ignored_workspace_directory(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | ".next"
            | "dist"
            | "build"
            | "target"
            | "coverage"
            | "__pycache__"
            | ".turbo"
            | ".cache"
            | ".pytest_cache"
            | ".mypy_cache"
    )
}

fn list_workspace_directory_impl(
    root: &Path,
    relative_path: &str,
) -> Result<WorkspaceDirectory, String> {
    let relative = workspace_relative_path(relative_path, true)?;
    let directory = ensure_inside_workspace(root, root.join(&relative))?;
    if !directory.is_dir() {
        return Err("The requested workspace path is not a directory".to_string());
    }

    let mut entries = Vec::new();
    let mut truncated = false;
    let read_dir = fs::read_dir(&directory)
        .map_err(|e| format!("Could not list workspace directory: {}", e))?;
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Could not read workspace entry: {}", e))?;
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if file_type.is_dir() && is_ignored_workspace_directory(&name) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !metadata.is_dir() && !metadata.is_file() {
            continue;
        }
        let child_relative = relative.join(&name);
        let Some(path) = path_to_workspace_string(&child_relative) else {
            continue;
        };
        entries.push(WorkspaceEntry {
            name,
            path,
            is_dir: metadata.is_dir(),
            size: if metadata.is_file() {
                metadata.len()
            } else {
                0
            },
            modified_at: workspace_modified_at(&metadata),
        });
        if entries.len() == MAX_WORKSPACE_DIRECTORY_ENTRIES {
            truncated = true;
            break;
        }
    }

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(WorkspaceDirectory {
        path: path_to_workspace_string(&relative).unwrap_or_default(),
        entries,
        truncated,
    })
}

fn index_workspace_files_impl(root: &Path) -> Result<WorkspaceFileIndex, String> {
    let mut files = Vec::new();
    let mut directories = vec![(root.to_path_buf(), PathBuf::new(), 0_usize)];
    let mut truncated = false;

    while let Some((directory, relative, depth)) = directories.pop() {
        let read_dir = match fs::read_dir(&directory) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let child_relative = relative.join(&name);
            if file_type.is_dir() {
                if is_ignored_workspace_directory(&name) {
                    continue;
                }
                if depth < MAX_WORKSPACE_INDEX_DEPTH {
                    directories.push((entry.path(), child_relative, depth + 1));
                } else {
                    truncated = true;
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if let Some(path) = path_to_workspace_string(&child_relative) {
                files.push(path);
            }
            if files.len() == MAX_WORKSPACE_INDEX_ENTRIES {
                truncated = true;
                directories.clear();
                break;
            }
        }
    }

    files.sort_by_key(|path| path.to_lowercase());
    Ok(WorkspaceFileIndex { files, truncated })
}

fn resolve_workspace_file(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = workspace_relative_path(relative_path, false)?;
    let target = ensure_inside_workspace(root, root.join(relative))?;
    if !target.is_file() {
        return Err("The requested workspace path is not a file".to_string());
    }
    Ok(target)
}

fn read_workspace_text_file_impl(
    root: &Path,
    relative_path: &str,
) -> Result<WorkspaceTextFile, String> {
    let target = resolve_workspace_file(root, relative_path)?;
    let metadata =
        fs::metadata(&target).map_err(|e| format!("Could not inspect workspace file: {}", e))?;
    if metadata.len() > MAX_WORKSPACE_FILE_BYTES {
        return Err(format!(
            "File is too large for the built-in editor (maximum {} MiB)",
            MAX_WORKSPACE_FILE_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(&target).map_err(|e| format!("Could not read workspace file: {}", e))?;
    if bytes.len() as u64 > MAX_WORKSPACE_FILE_BYTES {
        return Err(format!(
            "File is too large for the built-in editor (maximum {} MiB)",
            MAX_WORKSPACE_FILE_BYTES / 1024 / 1024
        ));
    }
    if bytes.contains(&0) {
        return Err("Binary files cannot be opened in the text editor".to_string());
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| "Binary or non-UTF-8 files cannot be opened in the text editor".to_string())?;
    let final_metadata = fs::metadata(&target)
        .map_err(|e| format!("Could not inspect workspace file after reading: {}", e))?;
    Ok(WorkspaceTextFile {
        path: relative_path.to_string(),
        size: content.len() as u64,
        modified_at: workspace_modified_at(&final_metadata),
        content,
    })
}

fn write_workspace_text_file_impl(
    root: &Path,
    relative_path: &str,
    content: &str,
    expected_content: &str,
) -> Result<WorkspaceTextFile, String> {
    if content.len() as u64 > MAX_WORKSPACE_FILE_BYTES {
        return Err(format!(
            "File is too large for the built-in editor (maximum {} MiB)",
            MAX_WORKSPACE_FILE_BYTES / 1024 / 1024
        ));
    }
    let current = read_workspace_text_file_impl(root, relative_path)?;
    if current.content != expected_content {
        return Err("File changed on disk. Reload it before saving your edits".to_string());
    }
    let target = resolve_workspace_file(root, relative_path)?;
    fs::write(&target, content.as_bytes())
        .map_err(|e| format!("Could not save workspace file: {}", e))?;
    read_workspace_text_file_impl(root, relative_path)
}

#[tauri::command]
async fn list_workspace_directory(
    workspace_root: String,
    relative_path: String,
) -> Result<WorkspaceDirectory, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    list_workspace_directory_impl(&root, &relative_path)
}

#[tauri::command]
async fn index_workspace_files(workspace_root: String) -> Result<WorkspaceFileIndex, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    index_workspace_files_impl(&root)
}

#[tauri::command]
async fn read_workspace_file(
    workspace_root: String,
    relative_path: String,
) -> Result<WorkspaceTextFile, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    read_workspace_text_file_impl(&root, &relative_path)
}

#[tauri::command]
async fn write_workspace_file(
    workspace_root: String,
    relative_path: String,
    content: String,
    expected_content: String,
) -> Result<WorkspaceTextFile, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    write_workspace_text_file_impl(&root, &relative_path, &content, &expected_content)
}

struct SpawnedTerminal {
    shell: String,
    pid: Option<u32>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(20, 400),
        rows: rows.clamp(5, 200),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn terminal_shell() -> Result<(PathBuf, String, Vec<String>), String> {
    #[cfg(target_os = "windows")]
    let candidates = ["pwsh.exe", "powershell.exe", "cmd.exe"];
    #[cfg(target_os = "macos")]
    let candidates = ["zsh", "bash", "sh"];
    #[cfg(all(unix, not(target_os = "macos")))]
    let candidates = ["bash", "zsh", "sh"];

    #[cfg(unix)]
    if let Ok(configured) = std::env::var("SHELL") {
        let configured_path = PathBuf::from(configured.trim());
        if configured_path.is_file() {
            let label = configured_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("shell")
                .to_string();
            return Ok((configured_path, label, Vec::new()));
        }
    }

    for candidate in candidates {
        let Ok(path) = which::which(candidate) else {
            continue;
        };
        let label = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(candidate)
            .to_string();
        #[cfg(target_os = "windows")]
        let args = if label.eq_ignore_ascii_case("cmd") {
            vec!["/Q".to_string()]
        } else {
            vec!["-NoLogo".to_string()]
        };
        #[cfg(not(target_os = "windows"))]
        let args = Vec::new();
        return Ok((path, label, args));
    }

    Err("No supported terminal shell was found".to_string())
}

fn spawn_terminal_process(root: &Path, cols: u16, rows: u16) -> Result<SpawnedTerminal, String> {
    let (shell_path, shell, args) = terminal_shell()?;
    spawn_terminal_process_with_shell(root, cols, rows, &shell_path, &shell, &args)
}

fn spawn_terminal_process_with_shell(
    root: &Path,
    cols: u16,
    rows: u16,
    shell_path: &Path,
    shell: &str,
    args: &[String],
) -> Result<SpawnedTerminal, String> {
    let pair = native_pty_system()
        .openpty(terminal_size(cols, rows))
        .map_err(|e| format!("Could not open a native PTY: {}", e))?;
    let mut command = CommandBuilder::new(shell_path);
    command.args(args);
    command.cwd(external_command_path(root));
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("Could not start {} in the native PTY: {}", shell, e))?;
    drop(pair.slave);
    let pid = child.process_id();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Could not open terminal output: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Could not open terminal input: {}", e))?;
    Ok(SpawnedTerminal {
        shell: shell.to_string(),
        pid,
        child,
        reader,
        writer,
        master: pair.master,
    })
}

#[tauri::command]
async fn terminal_start(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    workspace_root: String,
    cols: u16,
    rows: u16,
) -> Result<TerminalStartResult, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let spawned = spawn_terminal_process(&root, cols, rows)?;
    let terminal_id = format!(
        "terminal-{}-{}",
        std::process::id(),
        TERMINAL_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1
    );
    let shell = spawned.shell.clone();
    let pid = spawned.pid;
    let killer = spawned.child.clone_killer();
    let mut reader = spawned.reader;
    let mut child = spawned.child;

    {
        let mut instances = state
            .instances
            .lock()
            .map_err(|_| "Terminal state lock is poisoned".to_string())?;
        instances.insert(
            terminal_id.clone(),
            TerminalProcessHandle {
                pid,
                writer: Some(spawned.writer),
                master: Some(spawned.master),
                killer: Some(killer),
            },
        );
    }

    let output_id = terminal_id.clone();
    let output_app = app.clone();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputEventPayload {
                            terminal_id: output_id.clone(),
                            data: buffer[..read].to_vec(),
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let wait_id = terminal_id.clone();
    let wait_app = app;
    let wait_instances = state.instances.clone();
    std::thread::spawn(move || {
        let waited = child.wait();
        if let Ok(mut instances) = wait_instances.lock() {
            instances.remove(&wait_id);
        }
        let (exit_code, reason) = match waited {
            Ok(status) => (
                Some(status.exit_code()),
                status
                    .signal()
                    .map(|signal| format!("signal {}", signal))
                    .unwrap_or_else(|| format!("exit {}", status.exit_code())),
            ),
            Err(error) => (None, format!("wait failed: {}", error)),
        };
        let _ = wait_app.emit(
            "terminal-exit",
            TerminalExitEventPayload {
                terminal_id: wait_id,
                exit_code,
                reason,
            },
        );
    });

    Ok(TerminalStartResult {
        terminal_id,
        shell,
        pid,
    })
}

#[tauri::command]
async fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    if data.len() > 64 * 1024 {
        return Err("Terminal input chunk is too large".to_string());
    }
    let mut instances = state
        .instances
        .lock()
        .map_err(|_| "Terminal state lock is poisoned".to_string())?;
    let handle = instances
        .get_mut(terminal_id.trim())
        .ok_or_else(|| "Terminal is not running".to_string())?;
    let writer = handle
        .writer
        .as_mut()
        .ok_or_else(|| "Terminal input is closed".to_string())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|e| format!("Could not write to terminal: {}", e))
}

#[tauri::command]
async fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let instances = state
        .instances
        .lock()
        .map_err(|_| "Terminal state lock is poisoned".to_string())?;
    let handle = instances
        .get(terminal_id.trim())
        .ok_or_else(|| "Terminal is not running".to_string())?;
    let master = handle
        .master
        .as_ref()
        .ok_or_else(|| "Terminal PTY is closed".to_string())?;
    master
        .resize(terminal_size(cols, rows))
        .map_err(|e| format!("Could not resize terminal: {}", e))
}

#[tauri::command]
async fn terminal_stop(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
) -> Result<bool, String> {
    let mut handle = state
        .instances
        .lock()
        .map_err(|_| "Terminal state lock is poisoned".to_string())?
        .remove(terminal_id.trim());
    if let Some(handle) = handle.as_mut() {
        stop_terminal_instance(handle);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[derive(Debug, Serialize)]
struct PiAuthProviderStatus {
    provider: String,
    source: String,
    kind: String,
}

#[derive(Debug, Serialize)]
struct PiAuthStatus {
    agent_dir: Option<String>,
    auth_file: Option<String>,
    auth_file_exists: bool,
    configured_providers: Vec<PiAuthProviderStatus>,
}

fn provider_env_var_map() -> [(&'static str, &'static str); 16] {
    [
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("azure-openai-responses", "AZURE_OPENAI_API_KEY"),
        ("openai", "OPENAI_API_KEY"),
        ("google", "GEMINI_API_KEY"),
        ("mistral", "MISTRAL_API_KEY"),
        ("groq", "GROQ_API_KEY"),
        ("cerebras", "CEREBRAS_API_KEY"),
        ("xai", "XAI_API_KEY"),
        ("openrouter", "OPENROUTER_API_KEY"),
        ("vercel-ai-gateway", "AI_GATEWAY_API_KEY"),
        ("zai", "ZAI_API_KEY"),
        ("opencode", "OPENCODE_API_KEY"),
        ("huggingface", "HF_TOKEN"),
        ("kimi-coding", "KIMI_API_KEY"),
        ("minimax", "MINIMAX_API_KEY"),
        ("minimax-cn", "MINIMAX_CN_API_KEY"),
    ]
}

fn provider_env_var(provider: &str) -> Option<&'static str> {
    for (name, env_key) in provider_env_var_map() {
        if name == provider {
            return Some(env_key);
        }
    }
    None
}

fn provider_env_var_is_set(provider: &str) -> bool {
    provider_env_var(provider)
        .and_then(|env_key| std::env::var_os(env_key))
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

fn normalize_auth_provider(provider: &str) -> Result<String, String> {
    let normalized = provider.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("Provider cannot be empty".to_string());
    }
    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("Provider contains unsupported characters".to_string());
    }
    Ok(normalized)
}

fn read_auth_object(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read auth file '{}': {}", path.display(), e))?;
    let parsed = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("Invalid JSON in auth file '{}': {}", path.display(), e))?;
    parsed
        .as_object()
        .cloned()
        .ok_or_else(|| format!("Auth file '{}' must contain a JSON object", path.display()))
}

fn auth_provider_statuses_from_file(path: &Path) -> Result<Vec<PiAuthProviderStatus>, String> {
    let entries = read_auth_object(path)?;
    Ok(entries
        .iter()
        .map(|(provider, credential)| {
            let kind = credential
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown")
                .to_string();
            PiAuthProviderStatus {
                provider: provider.clone(),
                source: if kind == "oauth" {
                    "auth_file_oauth".to_string()
                } else {
                    "auth_file_api_key".to_string()
                },
                kind,
            }
        })
        .collect())
}

fn clear_provider_auth_file(path: &Path, provider: &str) -> Result<bool, String> {
    let mut entries = read_auth_object(path)?;
    if entries.remove(provider).is_none() {
        return Ok(false);
    }

    let serialized = serde_json::to_string_pretty(&serde_json::Value::Object(entries))
        .map_err(|e| format!("Failed to serialize auth file: {}", e))?;
    fs::write(path, format!("{}\n", serialized))
        .map_err(|e| format!("Failed to write auth file '{}': {}", path.display(), e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(true)
}

/// Inspect PI auth configuration from auth.json + environment variables.
#[tauri::command]
async fn get_pi_auth_status() -> Result<PiAuthStatus, String> {
    let agent_dir = get_pi_agent_dir();
    let auth_file_path = agent_dir.as_ref().map(|dir| dir.join("auth.json"));

    let mut configured_providers: Vec<PiAuthProviderStatus> = Vec::new();
    let auth_file_exists = auth_file_path
        .as_ref()
        .map(|path| path.exists() && path.is_file())
        .unwrap_or(false);

    if let Some(path) = &auth_file_path {
        if path.exists() && path.is_file() {
            configured_providers.extend(auth_provider_statuses_from_file(path)?);
        }
    }

    // Known provider env var mapping from docs/providers.md (core API key providers)
    for (provider, env_key) in provider_env_var_map() {
        let env_present = std::env::var_os(env_key)
            .map(|v| !v.is_empty())
            .unwrap_or(false);
        if !env_present {
            continue;
        }

        let already_listed = configured_providers.iter().any(|p| p.provider == provider);
        if already_listed {
            continue;
        }

        configured_providers.push(PiAuthProviderStatus {
            provider: provider.to_string(),
            source: "environment".to_string(),
            kind: "api_key".to_string(),
        });
    }

    configured_providers.sort_by(|a, b| a.provider.cmp(&b.provider));

    Ok(PiAuthStatus {
        agent_dir: agent_dir.map(|p| p.to_string_lossy().to_string()),
        auth_file: auth_file_path.map(|p| p.to_string_lossy().to_string()),
        auth_file_exists,
        configured_providers,
    })
}

#[derive(Debug, Serialize)]
struct PiProviderAuthClearResult {
    provider: String,
    removed: bool,
    source: String,
}

/// Remove provider credentials from ~/.pi/agent/auth.json when present.
#[tauri::command]
async fn clear_pi_provider_auth(provider: String) -> Result<PiProviderAuthClearResult, String> {
    let normalized = normalize_auth_provider(&provider)?;

    let agent_dir = get_pi_agent_dir();
    let auth_file_path = agent_dir.as_ref().map(|dir| dir.join("auth.json"));
    let mut removed = false;

    if let Some(path) = &auth_file_path {
        if path.exists() && path.is_file() {
            removed = clear_provider_auth_file(path, &normalized)?;
        }
    }

    let source = if removed {
        "auth_file"
    } else if provider_env_var_is_set(&normalized) {
        "environment"
    } else {
        "missing"
    }
    .to_string();

    Ok(PiProviderAuthClearResult {
        provider: normalized,
        removed,
        source,
    })
}

#[derive(Debug, Serialize, Clone)]
struct PiOAuthProviderInfo {
    id: String,
    name: String,
    source: String,
}

fn builtin_oauth_provider_info() -> Vec<PiOAuthProviderInfo> {
    vec![
        PiOAuthProviderInfo {
            id: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "github-copilot".to_string(),
            name: "GitHub Copilot".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "google-gemini-cli".to_string(),
            name: "Google Gemini CLI".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "google-antigravity".to_string(),
            name: "Google Antigravity".to_string(),
            source: "built_in".to_string(),
        },
        PiOAuthProviderInfo {
            id: "openai-codex".to_string(),
            name: "OpenAI Codex".to_string(),
            source: "built_in".to_string(),
        },
    ]
}

fn humanize_provider_id(provider_id: &str) -> String {
    provider_id
        .split(|ch: char| ch == '-' || ch == '_' || ch.is_whitespace())
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

fn parse_package_paths_from_pi_list_output(output: &str) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let candidate = PathBuf::from(trimmed);
        if !candidate.is_absolute() || !candidate.exists() || !candidate.is_dir() {
            continue;
        }

        let key = candidate.to_string_lossy().to_string();
        if seen.insert(key) {
            paths.push(candidate);
        }
    }

    paths
}

fn package_extension_entry_files(package_root: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = Vec::new();

    let package_json_path = package_root.join("package.json");
    if package_json_path.is_file() {
        if let Ok(content) = fs::read_to_string(&package_json_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(extensions) = parsed
                    .get("pi")
                    .and_then(|pi| pi.get("extensions"))
                    .and_then(|value| value.as_array())
                {
                    for entry in extensions {
                        let Some(raw) = entry.as_str() else {
                            continue;
                        };
                        let normalized = raw
                            .trim()
                            .trim_start_matches("./")
                            .trim_start_matches(".\\");
                        if normalized.is_empty() {
                            continue;
                        }
                        let candidate = package_root.join(normalized);
                        if candidate.is_file() {
                            files.push(candidate);
                        }
                    }
                }
            }
        }
    }

    if files.is_empty() {
        for fallback in [
            "index.ts",
            "index.js",
            "src/index.ts",
            "src/index.js",
            "src/index.mjs",
            "index.mjs",
        ] {
            let candidate = package_root.join(fallback);
            if candidate.is_file() {
                files.push(candidate);
            }
        }
    }

    files
}

fn parse_quoted_string(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        index += 1;
    }
    if index >= bytes.len() {
        return None;
    }

    let quote = bytes[index];
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    index += 1;
    let start = index;

    while index < bytes.len() {
        if bytes[index] == quote {
            return Some(value[start..index].to_string());
        }
        index += 1;
    }

    None
}

fn extract_oauth_name_from_segment(segment: &str, provider_id: &str) -> String {
    let oauth_pos = segment.find("oauth").unwrap_or(0);
    let oauth_segment = &segment[oauth_pos..];

    if let Some(name_pos) = oauth_segment.find("name") {
        let tail = &oauth_segment[name_pos + "name".len()..];
        if let Some(colon_pos) = tail.find(':') {
            let candidate = &tail[colon_pos + 1..];
            if let Some(name) = parse_quoted_string(candidate) {
                let trimmed = name.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }

    humanize_provider_id(provider_id)
}

fn extract_oauth_providers_from_source(source: &str) -> Vec<(String, String)> {
    let mut providers: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let needle = "registerProvider(";
    let mut cursor = 0usize;

    while cursor < source.len() {
        let Some(rel) = source[cursor..].find(needle) else {
            break;
        };
        let start = cursor + rel;
        let mut index = start + needle.len();
        let bytes = source.as_bytes();

        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }

        let quote = bytes[index];
        if quote != b'"' && quote != b'\'' {
            cursor = index.saturating_add(1);
            continue;
        }

        index += 1;
        let provider_start = index;
        while index < bytes.len() && bytes[index] != quote {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }

        let provider_id = source[provider_start..index].trim().to_lowercase();
        if provider_id.is_empty() {
            cursor = index.saturating_add(1);
            continue;
        }

        let segment_start = index;
        let mut scan_limit = (segment_start + 9000).min(source.len());
        while scan_limit > segment_start && !source.is_char_boundary(scan_limit) {
            scan_limit -= 1;
        }
        let segment_end = source[segment_start..scan_limit]
            .find(needle)
            .map(|next_rel| segment_start + next_rel)
            .unwrap_or(scan_limit);

        let segment = &source[segment_start..segment_end];
        if !segment.contains("oauth") {
            cursor = index.saturating_add(1);
            continue;
        }

        if seen.insert(provider_id.clone()) {
            let provider_name = extract_oauth_name_from_segment(segment, &provider_id);
            providers.push((provider_id, provider_name));
        }

        cursor = index.saturating_add(1);
    }

    providers
}

fn extract_oauth_providers_from_package(package_root: &Path) -> Vec<PiOAuthProviderInfo> {
    let mut providers: Vec<PiOAuthProviderInfo> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for file in package_extension_entry_files(package_root) {
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        for (id, name) in extract_oauth_providers_from_source(&content) {
            if !seen.insert(id.clone()) {
                continue;
            }
            providers.push(PiOAuthProviderInfo {
                id,
                name,
                source: "package".to_string(),
            });
        }
    }

    providers
}

/// Discover OAuth providers the same way users see in CLI /login:
/// built-ins + package-registered OAuth providers.
#[tauri::command]
async fn get_pi_oauth_providers(app: AppHandle) -> Result<Vec<PiOAuthProviderInfo>, String> {
    let mut providers = builtin_oauth_provider_info();
    let mut seen: HashSet<String> = providers
        .iter()
        .map(|provider| provider.id.clone())
        .collect();

    let Ok(pi) = discover_pi(&app) else {
        return Ok(providers);
    };

    let list_opts = PiCliCommandOptions {
        args: vec!["list".to_string()],
        cwd: Some(".".to_string()),
    };

    let output = match build_plain_command(&pi, &list_opts).output() {
        Ok(output) => output,
        Err(_) => return Ok(providers),
    };

    if !output.status.success() {
        return Ok(providers);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let package_paths = parse_package_paths_from_pi_list_output(&stdout);
    let mut custom_providers: Vec<PiOAuthProviderInfo> = Vec::new();

    for package_path in package_paths {
        for provider in extract_oauth_providers_from_package(&package_path) {
            if !seen.insert(provider.id.clone()) {
                continue;
            }
            custom_providers.push(provider);
        }
    }

    custom_providers.sort_by(|a, b| {
        let name_cmp = a.name.to_lowercase().cmp(&b.name.to_lowercase());
        if name_cmp != std::cmp::Ordering::Equal {
            return name_cmp;
        }
        a.id.cmp(&b.id)
    });

    providers.extend(custom_providers);
    Ok(providers)
}

/// Settings structure
#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme: String,
    pub thinking_level: String,
    pub auto_compaction: bool,
    pub auto_retry: bool,
    pub steering_mode: String,
    pub follow_up_mode: String,
    pub model_provider: Option<String>,
    pub model_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            thinking_level: "medium".to_string(),
            auto_compaction: true,
            auto_retry: true,
            steering_mode: "one-at-a-time".to_string(),
            follow_up_mode: "one-at-a-time".to_string(),
            model_provider: None,
            model_id: None,
        }
    }
}

/// Save app settings
#[tauri::command]
async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let data_dir = app_data_root(&app)?;

    // Ensure directory exists
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;

    let settings_path = data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(settings_path, json).map_err(|e| format!("Failed to write settings: {}", e))
}

/// Load app settings
#[tauri::command]
async fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
    let data_dir = app_data_root(&app)?;

    let settings_path = data_dir.join("settings.json");

    if !settings_path.exists() {
        return Ok(AppSettings::default());
    }

    let content =
        fs::read_to_string(settings_path).map_err(|e| format!("Failed to read settings: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))
}

/// Open a file dialog and return the selected path
#[tauri::command]
async fn open_file_dialog(_app: AppHandle, _multiple: bool) -> Result<Vec<String>, String> {
    // Placeholder: frontend currently uses @tauri-apps/plugin-dialog directly.
    Ok(Vec::new())
}

#[derive(Debug, Deserialize)]
struct PiCliCommandOptions {
    args: Vec<String>,
    cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum PiPackageScope {
    User,
    Project,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct PiPackageInfo {
    source: String,
    scope: PiPackageScope,
    installed_path: Option<String>,
    filtered: bool,
}

#[derive(Debug, Serialize)]
struct PiPackageListResult {
    packages: Vec<PiPackageInfo>,
}

#[derive(Debug, Serialize)]
struct PiPackageMutationResult {
    message: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct PiThemeInfo {
    name: String,
    path: Option<String>,
    scope: PiThemeScope,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum PiThemeScope {
    Builtin,
    User,
    Project,
}

struct PiPackageCommandOutput {
    status: ExitStatus,
    stdout: String,
    stderr: String,
    truncated: bool,
}

const MAX_GIT_DIFF_BYTES: usize = 512 * 1024;

#[derive(Debug, Serialize, PartialEq, Eq)]
struct GitChange {
    path: String,
    index_status: String,
    worktree_status: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct GitWorkspaceStatus {
    repository_root: String,
    branch: String,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<GitChange>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
struct GitDiffResult {
    content: String,
    truncated: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
struct GitWorktree {
    path: String,
    branch: Option<String>,
    head: String,
    is_main: bool,
    is_current: bool,
    dirty: bool,
    locked: bool,
    prunable: bool,
}

#[derive(Debug, Deserialize)]
struct ShareGistOptions {
    html_path: String,
}

#[derive(Debug, Serialize)]
struct ShareGistResult {
    gist_url: String,
    gist_id: String,
    preview_url: String,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Serialize)]
struct DesktopRuntimeInfo {
    platform: String,
    arch: String,
    version: String,
}

fn discover_gh_path() -> Option<PathBuf> {
    if let Ok(path) = which::which("gh") {
        return Some(path);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            candidates.push(PathBuf::from(&app_data).join("GitHub CLI").join("gh.exe"));
            candidates.push(PathBuf::from(&app_data).join("npm").join("gh.cmd"));
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("GitHub CLI")
                    .join("gh.exe"),
            );
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(
                PathBuf::from(program_files_x86)
                    .join("GitHub CLI")
                    .join("gh.exe"),
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/gh"));
        candidates.push(PathBuf::from("/usr/local/bin/gh"));
        candidates.push(PathBuf::from("/usr/bin/gh"));
        if let Some(home_dir) = resolve_home_dir() {
            candidates.push(home_dir.join(".local/bin/gh"));
            candidates.push(home_dir.join(".nvm/versions/node/current/bin/gh"));
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn parse_gist_url_from_output(output: &str) -> Option<String> {
    for token in output.split_whitespace() {
        let Some(start) = token.find("https://gist.github.com/") else {
            continue;
        };
        let mut url = token[start..]
            .trim_matches(|c: char| {
                c == '"' || c == '\'' || c == '`' || c == '(' || c == '[' || c == '{'
            })
            .to_string();

        while let Some(last) = url.chars().last() {
            if matches!(last, ')' | ']' | '}' | ',' | ';' | '.') {
                url.pop();
                continue;
            }
            break;
        }

        if !url.is_empty() {
            return Some(url);
        }
    }
    None
}

fn parse_gist_id_from_url(url: &str) -> Option<String> {
    let clean = url.trim().trim_end_matches('/');
    let parts: Vec<&str> = clean
        .split('/')
        .filter(|entry| !entry.trim().is_empty())
        .collect();
    let gist_id = parts.last()?.trim();
    if gist_id.len() < 20 {
        return None;
    }
    if !gist_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(gist_id.to_string())
}

fn build_plain_command(pi: &PiProcess, options: &PiCliCommandOptions) -> Command {
    let mut cmd = match pi {
        PiProcess::ManagedBinary { path, .. }
        | PiProcess::SidecarBinary { path }
        | PiProcess::PathBinary { path } => Command::new(path),
    };

    for arg in &options.args {
        cmd.arg(arg);
    }

    if let Some(cwd) = &options.cwd {
        cmd.current_dir(cwd);
    }

    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let PiProcess::PathBinary { path } = pi {
        if let Some(parent) = path.parent() {
            prepend_bin_dir_to_path(&mut cmd, parent);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd
}

fn read_capped_pi_output<R: Read>(mut reader: R) -> (Vec<u8>, bool) {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        let remaining = MAX_PI_PACKAGE_OUTPUT_BYTES.saturating_sub(output.len());
        if remaining > 0 {
            output.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        truncated |= count > remaining;
    }
    (output, truncated)
}

fn run_managed_pi_package_command(
    mut command: Command,
    active_child: Arc<Mutex<Option<Child>>>,
) -> Result<PiPackageCommandOutput, String> {
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start the Pi package command: {}", e))?;
    let Some(stdout) = child.stdout.take() else {
        stop_pi_package_process(&mut child);
        return Err("Pi package command stdout was unavailable".to_string());
    };
    let Some(stderr) = child.stderr.take() else {
        stop_pi_package_process(&mut child);
        return Err("Pi package command stderr was unavailable".to_string());
    };
    {
        let mut active = match active_child.lock() {
            Ok(active) => active,
            Err(_) => {
                stop_pi_package_process(&mut child);
                return Err("Pi package process state is unavailable".to_string());
            }
        };
        if active.is_some() {
            stop_pi_package_process(&mut child);
            return Err("Another Pi package command is already running".to_string());
        }
        *active = Some(child);
    }

    let stdout_reader = std::thread::spawn(move || read_capped_pi_output(stdout));
    let stderr_reader = std::thread::spawn(move || read_capped_pi_output(stderr));
    let deadline = Instant::now() + PI_PACKAGE_TIMEOUT;
    let status = loop {
        let poll = {
            let mut active = active_child
                .lock()
                .map_err(|_| "Pi package process state is unavailable".to_string())?;
            match active.as_mut() {
                Some(child) => child
                    .try_wait()
                    .map_err(|e| format!("Could not poll the Pi package command: {}", e))?,
                None => break Err("Pi package command was stopped".to_string()),
            }
        };
        if let Some(status) = poll {
            if let Ok(mut active) = active_child.lock() {
                active.take();
            }
            break Ok(status);
        }
        if Instant::now() >= deadline {
            stop_pi_package_child(&active_child);
            break Err(format!(
                "Pi package command timed out after {} seconds",
                PI_PACKAGE_TIMEOUT.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };

    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "Could not collect Pi package stdout".to_string())?;
    let (stderr, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "Could not collect Pi package stderr".to_string())?;
    let status = status?;

    Ok(PiPackageCommandOutput {
        status,
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        truncated: stdout_truncated || stderr_truncated,
    })
}

fn strip_ansi_sequences(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == 0x1b && bytes.get(index + 1) == Some(&b'[') {
            index += 2;
            while index < bytes.len() {
                let byte = bytes[index];
                index += 1;
                if (0x40..=0x7e).contains(&byte) {
                    break;
                }
            }
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn parse_pi_package_list(output: &str) -> Vec<PiPackageInfo> {
    let clean = strip_ansi_sequences(output);
    let mut scope: Option<PiPackageScope> = None;
    let mut packages: Vec<PiPackageInfo> = Vec::new();
    for line in clean.lines() {
        match line.trim() {
            "User packages:" => {
                scope = Some(PiPackageScope::User);
                continue;
            }
            "Project packages:" => {
                scope = Some(PiPackageScope::Project);
                continue;
            }
            _ => {}
        }
        let Some(current_scope) = scope else {
            continue;
        };
        if let Some(path) = line.strip_prefix("    ") {
            if let Some(package) = packages.last_mut() {
                let path = path.trim();
                if !path.is_empty() {
                    package.installed_path = Some(path.to_string());
                }
            }
            continue;
        }
        let Some(source) = line.strip_prefix("  ") else {
            continue;
        };
        let source = source.trim();
        if source.is_empty() {
            continue;
        }
        let (source, filtered) = source
            .strip_suffix(" (filtered)")
            .map(|value| (value.trim_end(), true))
            .unwrap_or((source, false));
        packages.push(PiPackageInfo {
            source: source.to_string(),
            scope: current_scope,
            installed_path: None,
            filtered,
        });
    }
    packages
}

fn validate_pi_package_source(raw: &str) -> Result<String, String> {
    let source = raw.trim();
    if source.is_empty() {
        return Err("Enter a Pi package source".to_string());
    }
    if source.len() > MAX_PI_PACKAGE_SOURCE_BYTES {
        return Err("Pi package source is too long".to_string());
    }
    if source.starts_with('-') || source.chars().any(char::is_control) {
        return Err("Pi package source contains unsupported characters".to_string());
    }
    Ok(source.to_string())
}

fn validate_pi_install_source(root: &Path, raw: &str) -> Result<String, String> {
    let source = validate_pi_package_source(raw)?;
    let remote = source.starts_with("npm:")
        || source.starts_with("git:")
        || source.starts_with("https://")
        || source.starts_with("http://")
        || source.starts_with("ssh://")
        || source.starts_with("git://");
    if remote {
        if source.chars().any(char::is_whitespace) {
            return Err("Remote Pi package sources cannot contain whitespace".to_string());
        }
        return Ok(source);
    }

    let requested = PathBuf::from(&source);
    let candidate = if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    };
    let resolved = ensure_inside_workspace(root, candidate).map_err(|_| {
        "Local Pi packages must be existing files or directories inside the selected workspace"
            .to_string()
    })?;
    Ok(external_command_path(&resolved)
        .to_string_lossy()
        .to_string())
}

fn describe_pi_package_failure(output: &PiPackageCommandOutput) -> String {
    let detail = if output.stderr.trim().is_empty() {
        output.stdout.trim()
    } else {
        output.stderr.trim()
    };
    let suffix = if output.truncated {
        " (output truncated)"
    } else {
        ""
    };
    if detail.is_empty() {
        format!(
            "Pi package command failed with exit code {}{}",
            output.status.code().unwrap_or(-1),
            suffix
        )
    } else {
        format!("{}{}", detail, suffix)
    }
}

fn pi_package_success_message(output: &PiPackageCommandOutput) -> String {
    let line = output
        .stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Pi package operation completed");
    if output.truncated {
        format!("{} (output truncated)", line)
    } else {
        line.to_string()
    }
}

async fn execute_pi_package_command(
    app: &AppHandle,
    state: &PiPackageState,
    root: &Path,
    args: Vec<String>,
) -> Result<PiPackageCommandOutput, String> {
    let _operation = state.operation.lock().await;
    let cwd = external_command_path(root).to_string_lossy().to_string();
    let pi = discover_pi(app)?;
    let options = PiCliCommandOptions {
        args,
        cwd: Some(cwd),
    };
    let command = build_plain_command(&pi, &options);
    let active_child = Arc::clone(&state.active_child);
    let output =
        tokio::task::spawn_blocking(move || run_managed_pi_package_command(command, active_child))
            .await
            .map_err(|e| format!("Pi package task failed: {}", e))??;
    if output.status.success() {
        Ok(output)
    } else {
        Err(describe_pi_package_failure(&output))
    }
}

#[tauri::command]
async fn list_pi_packages(
    app: AppHandle,
    state: tauri::State<'_, PiPackageState>,
    workspace_root: String,
    approve_project: bool,
) -> Result<PiPackageListResult, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let trust_flag = if approve_project {
        "--approve"
    } else {
        "--no-approve"
    };
    let output = execute_pi_package_command(
        &app,
        &state,
        &root,
        vec!["list".to_string(), trust_flag.to_string()],
    )
    .await?;
    Ok(PiPackageListResult {
        packages: parse_pi_package_list(&output.stdout),
    })
}

#[tauri::command]
async fn install_pi_package(
    app: AppHandle,
    state: tauri::State<'_, PiPackageState>,
    workspace_root: String,
    source: String,
    scope: PiPackageScope,
) -> Result<PiPackageMutationResult, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let source = validate_pi_install_source(&root, &source)?;
    let mut args = vec!["install".to_string(), source];
    match scope {
        PiPackageScope::User => args.push("--no-approve".to_string()),
        PiPackageScope::Project => {
            args.push("-l".to_string());
            args.push("--approve".to_string());
        }
    }
    let output = execute_pi_package_command(&app, &state, &root, args).await?;
    Ok(PiPackageMutationResult {
        message: pi_package_success_message(&output),
    })
}

#[tauri::command]
async fn remove_pi_package(
    app: AppHandle,
    state: tauri::State<'_, PiPackageState>,
    workspace_root: String,
    source: String,
    scope: PiPackageScope,
) -> Result<PiPackageMutationResult, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let source = validate_pi_package_source(&source)?;
    let mut args = vec!["remove".to_string(), source];
    match scope {
        PiPackageScope::User => args.push("--no-approve".to_string()),
        PiPackageScope::Project => {
            args.push("-l".to_string());
            args.push("--approve".to_string());
        }
    }
    let output = execute_pi_package_command(&app, &state, &root, args).await?;
    Ok(PiPackageMutationResult {
        message: pi_package_success_message(&output),
    })
}

#[tauri::command]
async fn update_pi_packages(
    app: AppHandle,
    state: tauri::State<'_, PiPackageState>,
    workspace_root: String,
    source: Option<String>,
    approve_project: bool,
) -> Result<PiPackageMutationResult, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let mut args = vec!["update".to_string()];
    if let Some(source) = source {
        args.push("--extension".to_string());
        args.push(validate_pi_package_source(&source)?);
    } else {
        args.push("--extensions".to_string());
    }
    args.push(
        if approve_project {
            "--approve"
        } else {
            "--no-approve"
        }
        .to_string(),
    );
    let output = execute_pi_package_command(&app, &state, &root, args).await?;
    Ok(PiPackageMutationResult {
        message: pi_package_success_message(&output),
    })
}

fn collect_direct_pi_themes(
    directory: &Path,
    scope: PiThemeScope,
    workspace_root: Option<&Path>,
    themes: &mut Vec<PiThemeInfo>,
) {
    let Ok(directory_metadata) = fs::symlink_metadata(directory) else {
        return;
    };
    if !directory_metadata.is_dir() || directory_metadata.file_type().is_symlink() {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_PI_THEME_BYTES
            || !path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let name = value
            .get("name")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .or_else(|| path.file_stem().and_then(|name| name.to_str()))
            .unwrap_or("unnamed")
            .to_string();
        let canonical_path = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let display_path = workspace_root
            .and_then(|root| canonical_path.strip_prefix(root).ok())
            .and_then(path_to_workspace_string)
            .unwrap_or_else(|| {
                external_command_path(&canonical_path)
                    .to_string_lossy()
                    .to_string()
            });
        themes.push(PiThemeInfo {
            name,
            path: Some(display_path),
            scope,
        });
    }
}

#[tauri::command]
async fn list_pi_themes(workspace_root: String) -> Result<Vec<PiThemeInfo>, String> {
    let root = canonical_workspace_root(&workspace_root)?;
    let mut themes = vec![
        PiThemeInfo {
            name: "dark".to_string(),
            path: None,
            scope: PiThemeScope::Builtin,
        },
        PiThemeInfo {
            name: "light".to_string(),
            path: None,
            scope: PiThemeScope::Builtin,
        },
    ];
    if let Some(agent_dir) = get_pi_agent_dir() {
        collect_direct_pi_themes(
            &agent_dir.join("themes"),
            PiThemeScope::User,
            None,
            &mut themes,
        );
    }
    collect_direct_pi_themes(
        &root.join(".pi").join("themes"),
        PiThemeScope::Project,
        Some(&root),
        &mut themes,
    );
    themes.sort_by(|left, right| {
        let left_scope = match left.scope {
            PiThemeScope::Builtin => 0,
            PiThemeScope::User => 1,
            PiThemeScope::Project => 2,
        };
        let right_scope = match right.scope {
            PiThemeScope::Builtin => 0,
            PiThemeScope::User => 1,
            PiThemeScope::Project => 2,
        };
        left_scope
            .cmp(&right_scope)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(themes)
}

fn git_output<I, S>(root: &Path, args: I) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let git_path = which::which("git").map_err(|_| "git was not found on PATH".to_string())?;
    let mut cmd = Command::new(git_path);
    cmd.arg("-C")
        .arg(external_command_path(root))
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.output()
        .map_err(|e| format!("Failed to run git: {}", e))
}

fn git_failure_message(output: &std::process::Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    fallback.to_string()
}

fn git_checked_output<I, S>(root: &Path, args: I, fallback: &str) -> Result<Vec<u8>, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let output = git_output(root, args)?;
    if !output.status.success() {
        return Err(git_failure_message(&output, fallback));
    }
    Ok(output.stdout)
}

fn resolve_git_repository(workspace_root: &str) -> Result<PathBuf, String> {
    let root = canonical_workspace_root(workspace_root)?;
    let output = git_checked_output(
        &root,
        ["rev-parse", "--show-toplevel"],
        "The selected workspace is not a Git repository",
    )?;
    let reported = String::from_utf8(output)
        .map_err(|_| "Git returned a non-UTF-8 repository path".to_string())?;
    let repository = fs::canonicalize(reported.trim())
        .map_err(|e| format!("Could not resolve the Git repository root: {}", e))?;
    if repository != root {
        return Err("Open the Git repository root to use Git and worktrees".to_string());
    }
    Ok(repository)
}

fn parse_git_branch_header(header: &str) -> (String, Option<String>, u32, u32) {
    let value = header.trim().strip_prefix("## ").unwrap_or(header.trim());
    if let Some(branch) = value.strip_prefix("No commits yet on ") {
        return (branch.trim().to_string(), None, 0, 0);
    }
    if value.starts_with("HEAD (no branch)") {
        return ("Detached HEAD".to_string(), None, 0, 0);
    }
    let Some((branch, tracking)) = value.split_once("...") else {
        return (value.to_string(), None, 0, 0);
    };
    let (upstream, state) = tracking
        .split_once(" [")
        .map(|(name, state)| (name.trim(), Some(state.trim_end_matches(']'))))
        .unwrap_or((tracking.trim(), None));
    let mut ahead = 0;
    let mut behind = 0;
    if let Some(state) = state {
        for item in state.split(',') {
            let item = item.trim();
            if let Some(value) = item.strip_prefix("ahead ") {
                ahead = value.parse().unwrap_or(0);
            } else if let Some(value) = item.strip_prefix("behind ") {
                behind = value.parse().unwrap_or(0);
            }
        }
    }
    (
        branch.trim().to_string(),
        if upstream.is_empty() {
            None
        } else {
            Some(upstream.to_string())
        },
        ahead,
        behind,
    )
}

fn parse_git_status(root: &Path, output: &[u8]) -> Result<GitWorkspaceStatus, String> {
    let records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .collect::<Vec<_>>();
    let header = records
        .first()
        .ok_or_else(|| "Git status did not return branch metadata".to_string())?;
    let (branch, upstream, ahead, behind) =
        parse_git_branch_header(&String::from_utf8_lossy(header));
    let mut changes = Vec::new();
    let mut index = 1;
    while index < records.len() {
        let record = records[index];
        if record.len() < 3 {
            index += 1;
            continue;
        }
        let index_status = char::from(record[0]).to_string();
        let worktree_status = char::from(record[1]).to_string();
        let path = String::from_utf8_lossy(&record[3..]).to_string();
        changes.push(GitChange {
            path,
            index_status: index_status.clone(),
            worktree_status: worktree_status.clone(),
        });
        if matches!(index_status.as_str(), "R" | "C")
            || matches!(worktree_status.as_str(), "R" | "C")
        {
            index += 1;
        }
        index += 1;
    }
    Ok(GitWorkspaceStatus {
        repository_root: external_command_path(root).to_string_lossy().to_string(),
        branch,
        upstream,
        ahead,
        behind,
        changes,
    })
}

fn get_git_workspace_status_impl(root: &Path) -> Result<GitWorkspaceStatus, String> {
    let output = git_checked_output(
        root,
        [
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--branch",
            "--untracked-files=normal",
        ],
        "Could not read Git status",
    )?;
    parse_git_status(root, &output)
}

fn bounded_git_diff(bytes: Vec<u8>) -> GitDiffResult {
    let truncated = bytes.len() > MAX_GIT_DIFF_BYTES;
    let slice = if truncated {
        &bytes[..MAX_GIT_DIFF_BYTES]
    } else {
        &bytes
    };
    let mut content = String::from_utf8_lossy(slice).to_string();
    if truncated {
        content.push_str("\n\n… diff truncated at 512 KiB …\n");
    }
    GitDiffResult { content, truncated }
}

fn get_git_diff_impl(
    root: &Path,
    relative_path: Option<&str>,
    staged: bool,
) -> Result<GitDiffResult, String> {
    let mut args = vec![
        std::ffi::OsString::from("--no-pager"),
        std::ffi::OsString::from("diff"),
        std::ffi::OsString::from("--no-ext-diff"),
        std::ffi::OsString::from("--no-textconv"),
        std::ffi::OsString::from("--unified=3"),
    ];
    if staged {
        args.push(std::ffi::OsString::from("--cached"));
    }
    args.push(std::ffi::OsString::from("--"));
    if let Some(path) = relative_path {
        let relative = workspace_relative_path(path.trim(), false)?;
        let normalized = path_to_workspace_string(&relative)
            .ok_or_else(|| "Git paths must be valid UTF-8 workspace paths".to_string())?;
        args.push(std::ffi::OsString::from(normalized));
    }
    let output = git_checked_output(root, args, "Could not read Git diff")?;
    Ok(bounded_git_diff(output))
}

#[derive(Default)]
struct RawGitWorktree {
    path: Option<PathBuf>,
    branch: Option<String>,
    head: String,
    locked: bool,
    prunable: bool,
}

fn parse_git_worktree_records(output: &[u8]) -> Vec<RawGitWorktree> {
    let mut parsed = Vec::new();
    let mut current = RawGitWorktree::default();
    for record in output.split(|byte| *byte == 0) {
        if record.is_empty() {
            if current.path.is_some() {
                parsed.push(current);
                current = RawGitWorktree::default();
            }
            continue;
        }
        let record = String::from_utf8_lossy(record);
        if let Some(value) = record.strip_prefix("worktree ") {
            if current.path.is_some() {
                parsed.push(current);
                current = RawGitWorktree::default();
            }
            current.path = Some(PathBuf::from(value));
        } else if let Some(value) = record.strip_prefix("HEAD ") {
            current.head = value.trim().to_string();
        } else if let Some(value) = record.strip_prefix("branch ") {
            current.branch = Some(
                value
                    .trim()
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value.trim())
                    .to_string(),
            );
        } else if record == "locked" || record.starts_with("locked ") {
            current.locked = true;
        } else if record == "prunable" || record.starts_with("prunable ") {
            current.prunable = true;
        }
    }
    if current.path.is_some() {
        parsed.push(current);
    }
    parsed
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn git_worktree_dirty(path: &Path) -> bool {
    if !path.is_dir() {
        return true;
    }
    match git_output(
        path,
        [
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=normal",
        ],
    ) {
        Ok(output) => !output.status.success() || !output.stdout.is_empty(),
        Err(_) => true,
    }
}

fn list_git_worktrees_impl(root: &Path) -> Result<Vec<GitWorktree>, String> {
    let output = git_checked_output(
        root,
        ["worktree", "list", "--porcelain", "-z"],
        "Could not list Git worktrees",
    )?;
    Ok(parse_git_worktree_records(&output)
        .into_iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let path = item.path?;
            Some(GitWorktree {
                dirty: git_worktree_dirty(&path),
                is_main: index == 0,
                is_current: paths_equal(&path, root),
                path: path.to_string_lossy().to_string(),
                branch: item.branch,
                head: item.head,
                locked: item.locked,
                prunable: item.prunable,
            })
        })
        .collect())
}

fn validate_worktree_branch(root: &Path, branch: &str) -> Result<String, String> {
    let branch = branch.trim();
    if branch.is_empty() || branch.len() > 160 {
        return Err("Enter a branch name between 1 and 160 characters".to_string());
    }
    if !branch
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/'))
    {
        return Err("Use letters, numbers, '.', '_', '-', or '/' in branch names".to_string());
    }
    let output = git_output(root, ["check-ref-format", "--branch", branch])?;
    if !output.status.success() {
        return Err(git_failure_message(&output, "Invalid Git branch name"));
    }
    Ok(branch.to_string())
}

fn worktree_destination(root: &Path, branch: &str) -> Result<PathBuf, String> {
    let command_root = external_command_path(root);
    let parent = command_root
        .parent()
        .ok_or_else(|| "The repository has no parent directory for a worktree".to_string())?;
    let repository_name = command_root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The repository folder name is not valid UTF-8".to_string())?;
    let slug = branch
        .chars()
        .map(|ch| if ch == '/' { '-' } else { ch })
        .collect::<String>();
    Ok(parent.join(format!("{}-{}", repository_name, slug)))
}

fn create_git_worktree_impl(
    root: &Path,
    branch: &str,
    create_branch: bool,
) -> Result<GitWorktree, String> {
    let branch = validate_worktree_branch(root, branch)?;
    let destination = worktree_destination(root, &branch)?;
    if destination.exists() {
        return Err(format!(
            "Worktree destination already exists: {}",
            destination.to_string_lossy()
        ));
    }
    if !create_branch {
        let reference = format!("refs/heads/{}", branch);
        let output = git_output(root, ["show-ref", "--verify", "--quiet", &reference])?;
        if !output.status.success() {
            return Err(format!("Local branch does not exist: {}", branch));
        }
    }
    let mut args = vec![
        std::ffi::OsString::from("worktree"),
        std::ffi::OsString::from("add"),
    ];
    if create_branch {
        args.push(std::ffi::OsString::from("-b"));
        args.push(std::ffi::OsString::from(&branch));
    }
    args.push(destination.as_os_str().to_owned());
    if !create_branch {
        args.push(std::ffi::OsString::from(&branch));
    }
    git_checked_output(root, args, "Could not create Git worktree")?;
    let canonical_destination = fs::canonicalize(&destination)
        .map_err(|e| format!("Created worktree could not be resolved: {}", e))?;
    list_git_worktrees_impl(root)?
        .into_iter()
        .find(|worktree| paths_equal(Path::new(&worktree.path), &canonical_destination))
        .ok_or_else(|| "Git created the worktree but did not list it".to_string())
}

fn remove_git_worktree_impl(root: &Path, worktree_path: &str) -> Result<bool, String> {
    let requested = PathBuf::from(worktree_path.trim());
    if requested.as_os_str().is_empty() {
        return Err("Choose a worktree to remove".to_string());
    }
    let worktree = list_git_worktrees_impl(root)?
        .into_iter()
        .find(|item| paths_equal(Path::new(&item.path), &requested))
        .ok_or_else(|| "The requested path is not a worktree of this repository".to_string())?;
    if worktree.is_main {
        return Err("The main worktree cannot be removed".to_string());
    }
    if worktree.is_current {
        return Err("The currently open worktree cannot be removed".to_string());
    }
    if worktree.locked {
        return Err("Locked worktrees cannot be removed".to_string());
    }
    if worktree.prunable || !Path::new(&worktree.path).is_dir() {
        return Err("Prunable worktree metadata is not removed by this UI".to_string());
    }
    if worktree.dirty {
        return Err(
            "Worktree has uncommitted or untracked files; clean it before removal".to_string(),
        );
    }
    git_checked_output(
        root,
        [
            std::ffi::OsString::from("worktree"),
            std::ffi::OsString::from("remove"),
            Path::new(&worktree.path).as_os_str().to_owned(),
        ],
        "Could not remove Git worktree",
    )?;
    Ok(true)
}

#[tauri::command]
async fn get_git_workspace_status(workspace_root: String) -> Result<GitWorkspaceStatus, String> {
    tokio::task::spawn_blocking(move || {
        let root = resolve_git_repository(&workspace_root)?;
        get_git_workspace_status_impl(&root)
    })
    .await
    .map_err(|e| format!("Git status task failed: {}", e))?
}

#[tauri::command]
async fn get_git_diff(
    workspace_root: String,
    relative_path: Option<String>,
    staged: bool,
) -> Result<GitDiffResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = resolve_git_repository(&workspace_root)?;
        get_git_diff_impl(&root, relative_path.as_deref(), staged)
    })
    .await
    .map_err(|e| format!("Git diff task failed: {}", e))?
}

#[tauri::command]
async fn list_git_worktrees(workspace_root: String) -> Result<Vec<GitWorktree>, String> {
    tokio::task::spawn_blocking(move || {
        let root = resolve_git_repository(&workspace_root)?;
        list_git_worktrees_impl(&root)
    })
    .await
    .map_err(|e| format!("Git worktree task failed: {}", e))?
}

#[tauri::command]
async fn create_git_worktree(
    workspace_root: String,
    branch: String,
    create_branch: bool,
) -> Result<GitWorktree, String> {
    tokio::task::spawn_blocking(move || {
        let root = resolve_git_repository(&workspace_root)?;
        create_git_worktree_impl(&root, &branch, create_branch)
    })
    .await
    .map_err(|e| format!("Git worktree creation task failed: {}", e))?
}

#[tauri::command]
async fn remove_git_worktree(
    workspace_root: String,
    worktree_path: String,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let root = resolve_git_repository(&workspace_root)?;
        remove_git_worktree_impl(&root, &worktree_path)
    })
    .await
    .map_err(|e| format!("Git worktree removal task failed: {}", e))?
}

#[tauri::command]
async fn create_share_gist(options: ShareGistOptions) -> Result<ShareGistResult, String> {
    let html_path_raw = options.html_path.trim();
    if html_path_raw.is_empty() {
        return Err("No export file path provided".to_string());
    }

    let html_path = PathBuf::from(html_path_raw);
    if !html_path.is_file() {
        return Err(format!(
            "Exported session file not found: {}",
            html_path_raw
        ));
    }

    let gh_path = discover_gh_path().ok_or_else(|| {
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/".to_string()
    })?;

    let mut auth_cmd = Command::new(&gh_path);
    auth_cmd
        .arg("auth")
        .arg("status")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        auth_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let auth_output = auth_cmd
        .output()
        .map_err(|e| format!("Failed to run gh auth status: {}", e))?;

    if !auth_output.status.success() {
        return Err("GitHub CLI is not logged in. Run 'gh auth login' first.".to_string());
    }

    let mut gist_cmd = Command::new(&gh_path);
    gist_cmd
        .arg("gist")
        .arg("create")
        .arg("--public=false")
        .arg(&html_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(parent) = html_path.parent() {
        gist_cmd.current_dir(parent);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        gist_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let gist_output = gist_cmd
        .output()
        .map_err(|e| format!("Failed to run gh gist create: {}", e))?;

    let stdout = String::from_utf8_lossy(&gist_output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&gist_output.stderr).to_string();

    if !gist_output.status.success() {
        let message = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!(
                "gh gist create failed with exit code {}",
                gist_output.status.code().unwrap_or(-1)
            )
        };
        return Err(format!("Failed to create gist: {}", message));
    }

    let combined = format!("{}\n{}", stdout, stderr);
    let gist_url = parse_gist_url_from_output(&combined)
        .ok_or_else(|| "Failed to parse gist URL from gh output".to_string())?;
    let gist_id = parse_gist_id_from_url(&gist_url)
        .ok_or_else(|| "Failed to parse gist ID from gh output".to_string())?;
    let preview_url = format!("https://pi.dev/session/#{}", gist_id);

    Ok(ShareGistResult {
        gist_url,
        gist_id,
        preview_url,
        stdout,
        stderr,
    })
}

#[tauri::command]
async fn get_desktop_runtime_info(app: AppHandle) -> Result<DesktopRuntimeInfo, String> {
    Ok(DesktopRuntimeInfo {
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        version: app.package_info().version.to_string(),
    })
}

#[tauri::command]
async fn get_pi_runtime_status(
    app: AppHandle,
    rpc_state: tauri::State<'_, RpcState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
    check_updates: bool,
) -> Result<desktop_runtime::PiRuntimeStatus, String> {
    let settings = desktop_runtime::load_settings(&app)?;
    let active_rpc_count = active_rpc_count(&rpc_state)?;
    let installed_versions = desktop_runtime::list_installed_runtimes(&app)?;
    let operation_active = runtime_state.is_operation_active();

    let (effective_source, managed, fallback, executable, known_version, mut note) =
        match discover_pi(&app) {
            Ok(PiProcess::ManagedBinary { path, version }) => (
                "managed".to_string(),
                true,
                false,
                Some(path),
                Some(version),
                None,
            ),
            Ok(PiProcess::SidecarBinary { path }) => (
                "bundled".to_string(),
                true,
                false,
                Some(path),
                None,
                Some("The bundled Pi runtime is updated with Pi GUI.".to_string()),
            ),
            Ok(PiProcess::PathBinary { path }) => {
                let fallback = settings.mode == desktop_runtime::RuntimeMode::Managed;
                (
                    "system".to_string(),
                    false,
                    fallback,
                    Some(path),
                    None,
                    fallback.then(|| {
                        "Managed Pi is not installed; using the existing system Pi fallback."
                            .to_string()
                    }),
                )
            }
            Err(error) => (
                "unavailable".to_string(),
                false,
                false,
                None,
                None,
                Some(error),
            ),
        };

    let current_version = if let Some(version) = known_version {
        Some(version)
    } else if let Some(path) = executable.clone() {
        match tokio::task::spawn_blocking(move || desktop_runtime::version_at_path(&path)).await {
            Ok(Ok(version)) => Some(version),
            Ok(Err(error)) => {
                note = Some(error);
                None
            }
            Err(error) => {
                note = Some(format!("Pi version check task failed: {error}"));
                None
            }
        }
    } else {
        None
    };

    let release = if check_updates {
        Some(
            tokio::task::spawn_blocking(desktop_runtime::fetch_latest_release)
                .await
                .map_err(|error| format!("Pi release check task failed: {error}"))??,
        )
    } else {
        None
    };
    let latest_version = release.as_ref().map(|release| release.version.clone());
    let update_available = match (&latest_version, &current_version) {
        (Some(latest), Some(current)) => desktop_runtime::is_newer_release(latest, current),
        (Some(_), None) => true,
        _ => false,
    };

    Ok(desktop_runtime::PiRuntimeStatus {
        mode: settings.mode,
        effective_source,
        managed,
        fallback,
        current_version,
        latest_version,
        update_available,
        executable: executable.map(|path| path.to_string_lossy().to_string()),
        system_pi_path: settings.system_pi_path,
        installed_versions,
        operation_active,
        active_rpc_count,
        note,
        release_notes: release
            .as_ref()
            .map(|release| release.release_notes.clone()),
        release_url: release.as_ref().map(|release| release.release_url.clone()),
        published_at: release.and_then(|release| release.published_at),
    })
}

#[tauri::command]
async fn set_pi_runtime_settings(
    app: AppHandle,
    rpc_state: tauri::State<'_, RpcState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
    mode: desktop_runtime::RuntimeMode,
    system_pi_path: Option<String>,
) -> Result<desktop_runtime::RuntimeSettings, String> {
    let _operation = runtime_state.begin_operation()?;
    if active_rpc_count(&rpc_state)? > 0 {
        return Err("Disconnect all Pi sessions before changing the runtime source".to_string());
    }

    if mode == desktop_runtime::RuntimeMode::System {
        if let Some(raw) = system_pi_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            let path = resolve_explicit_pi_path(raw)
                .ok_or_else(|| format!("Configured system Pi path was not found: {raw}"))?;
            let verified_path = path.clone();
            tokio::task::spawn_blocking(move || desktop_runtime::version_at_path(&verified_path))
                .await
                .map_err(|error| format!("System Pi validation task failed: {error}"))??;
        }
    }

    let settings = desktop_runtime::save_settings(&app, mode, system_pi_path)?;
    runtime_state.logger().record(
        "info",
        "runtime_settings_changed",
        &format!("Runtime mode set to {:?}", settings.mode),
    );
    Ok(settings)
}

#[tauri::command]
async fn install_managed_pi_runtime(
    app: AppHandle,
    rpc_state: tauri::State<'_, RpcState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
) -> Result<desktop_runtime::ManagedInstallResult, String> {
    let _operation = runtime_state.begin_operation()?;
    if active_rpc_count(&rpc_state)? > 0 {
        return Err("Disconnect all Pi sessions before installing or updating Pi".to_string());
    }
    let app_for_install = app.clone();
    let logger = runtime_state.logger();
    let logger_for_error = logger.clone();
    let result = tokio::task::spawn_blocking(move || {
        desktop_runtime::install_latest_runtime(&app_for_install, &logger)
    })
    .await
    .map_err(|error| format!("Managed Pi installation task failed: {error}"))?;
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            logger_for_error.record("error", "runtime_install_failed", &error);
            return Err(error);
        }
    };
    let prior_settings = desktop_runtime::load_settings(&app)?;
    desktop_runtime::save_settings(
        &app,
        desktop_runtime::RuntimeMode::Managed,
        prior_settings.system_pi_path,
    )?;
    Ok(result)
}

#[tauri::command]
async fn activate_managed_pi_runtime(
    app: AppHandle,
    rpc_state: tauri::State<'_, RpcState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
    version: String,
) -> Result<desktop_runtime::ManagedInstallResult, String> {
    let _operation = runtime_state.begin_operation()?;
    if active_rpc_count(&rpc_state)? > 0 {
        return Err("Disconnect all Pi sessions before rolling back Pi".to_string());
    }
    let app_for_activation = app.clone();
    let logger = runtime_state.logger();
    let result = tokio::task::spawn_blocking(move || {
        desktop_runtime::activate_installed_runtime(&app_for_activation, version.trim(), &logger)
    })
    .await
    .map_err(|error| format!("Managed Pi rollback task failed: {error}"))??;
    let prior_settings = desktop_runtime::load_settings(&app)?;
    desktop_runtime::save_settings(
        &app,
        desktop_runtime::RuntimeMode::Managed,
        prior_settings.system_pi_path,
    )?;
    Ok(result)
}

#[tauri::command]
async fn get_pi_runtime_diagnostics(
    app: AppHandle,
    rpc_state: tauri::State<'_, RpcState>,
    terminal_state: tauri::State<'_, TerminalState>,
    runtime_state: tauri::State<'_, desktop_runtime::DesktopRuntimeState>,
) -> Result<desktop_runtime::RuntimeDiagnostics, String> {
    let active_rpc_count = active_rpc_count(&rpc_state)?;
    let active_terminal_count = terminal_state
        .instances
        .lock()
        .map_err(|_| "Failed to acquire terminal instances lock".to_string())?
        .len();
    desktop_runtime::diagnostics(
        &app,
        &runtime_state,
        active_rpc_count,
        active_terminal_count,
    )
}

#[tauri::command]
async fn open_path_in_default_app(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("No path provided".to_string());
    }

    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", trimmed));
    }

    #[cfg(target_os = "macos")]
    {
        let primary = Command::new("open")
            .arg(&target)
            .output()
            .map_err(|e| format!("Failed to launch open command: {}", e))?;

        if primary.status.success() {
            return Ok(());
        }

        // Some files (e.g. .sample hooks in .git) have no associated app.
        // Fall back to TextEdit so "Open in editor" still works.
        let fallback = Command::new("open")
            .arg("-a")
            .arg("TextEdit")
            .arg(&target)
            .output()
            .map_err(|e| format!("Failed to launch TextEdit fallback: {}", e))?;

        if fallback.status.success() {
            return Ok(());
        }

        let primary_stderr = String::from_utf8_lossy(&primary.stderr).trim().to_string();
        let fallback_stderr = String::from_utf8_lossy(&fallback.stderr).trim().to_string();
        return Err(format!(
            "Could not open file. default-app error: {} | TextEdit fallback error: {}",
            if primary_stderr.is_empty() {
                format!("exit code {}", primary.status.code().unwrap_or(-1))
            } else {
                primary_stderr
            },
            if fallback_stderr.is_empty() {
                format!("exit code {}", fallback.status.code().unwrap_or(-1))
            } else {
                fallback_stderr
            }
        ));
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("xdg-open")
            .arg(&target)
            .output()
            .map_err(|e| format!("Failed to launch xdg-open command: {}", e))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "Could not open file (exit code {})",
                output.status.code().unwrap_or(-1)
            )
        } else {
            format!("Could not open file: {}", stderr)
        });
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(target.as_os_str())
            .output()
            .map_err(|e| format!("Failed to launch start command: {}", e))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!(
                "Could not open file (exit code {})",
                output.status.code().unwrap_or(-1)
            )
        } else {
            format!("Could not open file: {}", stderr)
        });
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for open_path_in_default_app".to_string())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(desktop_runtime::DesktopRuntimeState::default())
        .setup(|app| {
            let runtime_state = app.state::<desktop_runtime::DesktopRuntimeState>();
            runtime_state.initialize(app.handle());
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ =
                        window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
                    let _ = window.set_shadow(true);
                }
            }
            Ok(())
        })
        .manage(RpcState::default())
        .manage(TerminalState::default())
        .manage(PiPackageState::default())
        .invoke_handler(tauri::generate_handler![
            rpc_start,
            rpc_send,
            rpc_stop,
            rpc_stop_all,
            rpc_is_running,
            rpc_ui_response,
            list_sessions,
            delete_session,
            get_session_content,
            list_workspace_directory,
            index_workspace_files,
            read_workspace_file,
            write_workspace_file,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_stop,
            get_pi_auth_status,
            get_pi_oauth_providers,
            clear_pi_provider_auth,
            save_settings,
            load_settings,
            open_file_dialog,
            list_pi_packages,
            install_pi_package,
            remove_pi_package,
            update_pi_packages,
            list_pi_themes,
            get_git_workspace_status,
            get_git_diff,
            list_git_worktrees,
            create_git_worktree,
            remove_git_worktree,
            create_share_gist,
            get_desktop_runtime_info,
            get_pi_runtime_status,
            set_pi_runtime_settings,
            install_managed_pi_runtime,
            activate_managed_pi_runtime,
            get_pi_runtime_diagnostics,
            open_path_in_default_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            let state = app_handle.state::<RpcState>();
            if let Ok(mut instances) = state.instances.lock() {
                for (_, mut handle) in instances.drain() {
                    stop_rpc_instance(&mut handle);
                }
            };
            let terminal_state = app_handle.state::<TerminalState>();
            if let Ok(mut instances) = terminal_state.instances.lock() {
                for (_, mut handle) in instances.drain() {
                    stop_terminal_instance(&mut handle);
                }
            };
            let package_state = app_handle.state::<PiPackageState>();
            stop_pi_package_child(&package_state.active_child);
            let runtime_state = app_handle.state::<desktop_runtime::DesktopRuntimeState>();
            runtime_state.record_shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        auth_provider_statuses_from_file, clear_provider_auth_file, collect_direct_pi_themes,
        create_git_worktree_impl, delete_session_file, get_git_diff_impl,
        get_git_workspace_status_impl, index_workspace_files_impl, list_git_worktrees_impl,
        list_workspace_directory_impl, normalize_auth_provider, parse_git_status,
        parse_pi_package_list, read_session_file, read_workspace_text_file_impl,
        remove_git_worktree_impl, spawn_terminal_process, spawn_terminal_process_with_shell,
        validate_app_data_override, validate_pi_install_source, validate_pi_package_source,
        write_workspace_text_file_impl, PiPackageScope, PiThemeScope, SpawnedTerminal,
        MAX_WORKSPACE_FILE_BYTES,
    };
    use std::fs;
    use std::io::{Read, Write};
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;
    #[cfg(target_os = "windows")]
    use std::time::Instant;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "pi-gui-session-delete-{}-{}",
            std::process::id(),
            nonce
        ))
    }

    fn run_test_git(root: &std::path::Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("run git test command");
        assert!(status.success(), "git command failed: git {:?}", args);
    }

    #[test]
    fn accepts_only_absolute_non_root_app_data_overrides() {
        let valid = std::env::temp_dir().join("pi-gui-data-override-test");
        assert_eq!(
            validate_app_data_override(Some(valid.clone().into_os_string()))
                .expect("accept absolute app data override"),
            Some(valid)
        );
        assert!(validate_app_data_override(Some("relative/path".into())).is_err());
        assert!(
            validate_app_data_override(Some(std::path::MAIN_SEPARATOR.to_string().into())).is_err()
        );
        assert_eq!(
            validate_app_data_override(None).expect("allow missing override"),
            None
        );
    }

    #[test]
    fn deletes_only_jsonl_files_inside_the_sessions_root() {
        let root = test_root();
        let sessions = root.join("sessions");
        let nested = sessions.join("project");
        fs::create_dir_all(&nested).expect("create test sessions directory");
        let session = nested.join("session.jsonl");
        fs::write(&session, "{\"type\":\"session\"}\n").expect("write test session");

        assert!(delete_session_file(&sessions, &session).expect("delete valid session"));
        assert!(!session.exists());
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn rejects_files_outside_the_sessions_root() {
        let root = test_root();
        let sessions = root.join("sessions");
        fs::create_dir_all(&sessions).expect("create test sessions directory");
        let outside = root.join("outside.jsonl");
        fs::write(&outside, "{\"type\":\"session\"}\n").expect("write outside file");

        let error =
            delete_session_file(&sessions, &outside).expect_err("outside file must be rejected");
        assert!(error.contains("outside the Pi sessions directory"));
        assert!(outside.exists());
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn reads_only_jsonl_files_inside_the_sessions_root() {
        let root = test_root();
        let sessions = root.join("sessions");
        fs::create_dir_all(&sessions).expect("create test sessions directory");
        let session = sessions.join("session.jsonl");
        let outside = root.join("outside.jsonl");
        fs::write(&session, "{\"type\":\"session\"}\n").expect("write session file");
        fs::write(&outside, "secret\n").expect("write outside file");

        assert_eq!(
            read_session_file(&sessions, &session).expect("read valid session"),
            "{\"type\":\"session\"}\n"
        );
        assert!(read_session_file(&sessions, &outside).is_err());
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn lists_and_indexes_only_regular_workspace_entries() {
        let root = test_root();
        let workspace = root.join("workspace");
        fs::create_dir_all(workspace.join("src")).expect("create source directory");
        fs::create_dir_all(workspace.join("node_modules")).expect("create ignored directory");
        fs::create_dir_all(workspace.join(".git")).expect("create git directory");
        fs::write(workspace.join("README.md"), "hello\n").expect("write root file");
        fs::write(workspace.join("src").join("main.ts"), "export {};\n")
            .expect("write nested file");
        fs::write(
            workspace.join("node_modules").join("ignored.js"),
            "ignored\n",
        )
        .expect("write ignored file");
        let canonical = fs::canonicalize(&workspace).expect("canonical workspace");

        let directory = list_workspace_directory_impl(&canonical, "").expect("list workspace");
        assert_eq!(
            directory
                .entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["src", "README.md"]
        );
        assert!(!directory.truncated);

        let index = index_workspace_files_impl(&canonical).expect("index workspace");
        assert_eq!(index.files, vec!["README.md", "src/main.ts"]);
        assert!(!index.truncated);
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn workspace_reads_reject_traversal_binary_and_symlink_escape() {
        let root = test_root();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).expect("create workspace");
        fs::write(workspace.join("notes.txt"), "safe\n").expect("write text file");
        fs::write(workspace.join("binary.bin"), [0_u8, 1, 2]).expect("write binary file");
        fs::write(
            workspace.join("large.txt"),
            vec![b'x'; MAX_WORKSPACE_FILE_BYTES as usize + 1],
        )
        .expect("write oversized file");
        let outside = root.join("outside.txt");
        fs::write(&outside, "secret\n").expect("write outside file");
        let canonical = fs::canonicalize(&workspace).expect("canonical workspace");

        assert_eq!(
            read_workspace_text_file_impl(&canonical, "notes.txt")
                .expect("read workspace text")
                .content,
            "safe\n"
        );
        assert!(read_workspace_text_file_impl(&canonical, "../outside.txt").is_err());
        assert!(read_workspace_text_file_impl(&canonical, "binary.bin").is_err());
        assert!(read_workspace_text_file_impl(&canonical, "large.txt").is_err());

        let link = workspace.join("outside-link.txt");
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_file(&outside, &link).is_ok();
        if linked {
            assert!(read_workspace_text_file_impl(&canonical, "outside-link.txt").is_err());
            let directory = list_workspace_directory_impl(&canonical, "").expect("list workspace");
            assert!(!directory
                .entries
                .iter()
                .any(|entry| entry.name == "outside-link.txt"));
        }

        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn workspace_save_refuses_to_overwrite_external_changes() {
        let root = test_root();
        let workspace = root.join("workspace");
        fs::create_dir_all(&workspace).expect("create workspace");
        let file = workspace.join("notes.txt");
        fs::write(&file, "first\n").expect("write initial file");
        let canonical = fs::canonicalize(&workspace).expect("canonical workspace");

        let saved = write_workspace_text_file_impl(&canonical, "notes.txt", "second\n", "first\n")
            .expect("save matching revision");
        assert_eq!(saved.content, "second\n");
        fs::write(&file, "external\n").expect("write external change");
        let error = write_workspace_text_file_impl(&canonical, "notes.txt", "third\n", "second\n")
            .expect_err("stale revision must fail");
        assert!(error.contains("changed on disk"));
        assert_eq!(
            fs::read_to_string(&file).expect("read preserved external change"),
            "external\n"
        );
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn parses_user_project_and_filtered_pi_packages() {
        let packages = parse_pi_package_list(
            "User packages:\n  npm:alpha@1.0.0\n    C:\\pi\\alpha\n\nProject packages:\n  git:example.test/team/tools (filtered)\n    C:\\work\\.pi\\git\\tools\n",
        );
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].scope, PiPackageScope::User);
        assert_eq!(packages[0].source, "npm:alpha@1.0.0");
        assert_eq!(packages[0].installed_path.as_deref(), Some("C:\\pi\\alpha"));
        assert!(!packages[0].filtered);
        assert_eq!(packages[1].scope, PiPackageScope::Project);
        assert_eq!(packages[1].source, "git:example.test/team/tools");
        assert!(packages[1].filtered);
    }

    #[test]
    fn package_sources_are_arguments_and_local_installs_stay_in_workspace() {
        let root = test_root();
        let workspace = root.join("workspace");
        let package = workspace.join("safe package");
        fs::create_dir_all(&package).expect("create local package");
        let canonical = fs::canonicalize(&workspace).expect("canonical workspace");

        assert_eq!(
            validate_pi_install_source(&canonical, " npm:@scope/tools@1.2.3 ")
                .expect("valid npm source"),
            "npm:@scope/tools@1.2.3"
        );
        assert!(validate_pi_install_source(&canonical, "npm:bad package").is_err());
        let local = validate_pi_install_source(&canonical, "./safe package")
            .expect("workspace local package");
        assert!(fs::canonicalize(local)
            .expect("canonical validated package")
            .starts_with(&canonical));
        assert!(validate_pi_install_source(&canonical, "../outside").is_err());
        assert!(validate_pi_package_source("--force").is_err());
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn lists_only_valid_direct_pi_theme_files() {
        let root = test_root();
        let workspace = root.join("workspace");
        let themes_dir = workspace.join(".pi").join("themes");
        fs::create_dir_all(&themes_dir).expect("create theme directory");
        fs::write(
            themes_dir.join("warm.json"),
            r#"{"name":"warm-paper","colors":{}}"#,
        )
        .expect("write valid theme");
        fs::write(themes_dir.join("broken.json"), "{broken").expect("write invalid theme");
        fs::write(themes_dir.join("notes.txt"), "not a theme").expect("write non-theme file");
        let canonical = fs::canonicalize(&workspace).expect("canonical workspace");
        let mut themes = Vec::new();
        collect_direct_pi_themes(
            &themes_dir,
            PiThemeScope::Project,
            Some(&canonical),
            &mut themes,
        );
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].name, "warm-paper");
        assert_eq!(themes[0].path.as_deref(), Some(".pi/themes/warm.json"));
        assert_eq!(themes[0].scope, PiThemeScope::Project);
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn parses_git_branch_tracking_and_rename_records() {
        let root = test_root();
        let status = parse_git_status(
            &root,
            b"## main...origin/main [ahead 2, behind 1]\0 M src/main.ts\0R  src/new.ts\0src/old.ts\0?? notes.txt\0",
        )
        .expect("parse porcelain status");
        assert_eq!(status.branch, "main");
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert_eq!(status.changes.len(), 3);
        assert_eq!(status.changes[0].path, "src/main.ts");
        assert_eq!(status.changes[1].path, "src/new.ts");
        assert_eq!(status.changes[2].path, "notes.txt");
    }

    #[test]
    fn runs_real_git_status_diff_and_guarded_worktree_flow() {
        let root = test_root();
        let repository = root.join("repo");
        fs::create_dir_all(&repository).expect("create test repository");
        run_test_git(&repository, &["init", "-b", "main"]);
        run_test_git(&repository, &["config", "user.name", "Pi GUI Test"]);
        run_test_git(
            &repository,
            &["config", "user.email", "pi-gui@example.invalid"],
        );
        fs::write(repository.join("tracked.txt"), "first\n").expect("write tracked file");
        run_test_git(&repository, &["add", "tracked.txt"]);
        run_test_git(
            &repository,
            &["-c", "commit.gpgsign=false", "commit", "-m", "baseline"],
        );
        let canonical = fs::canonicalize(&repository).expect("canonical test repository");

        let clean = get_git_workspace_status_impl(&canonical).expect("read clean status");
        assert_eq!(clean.branch, "main");
        assert!(clean.changes.is_empty());

        fs::write(repository.join("tracked.txt"), "second\n").expect("modify tracked file");
        fs::write(repository.join("untracked.txt"), "new\n").expect("write untracked file");
        let dirty = get_git_workspace_status_impl(&canonical).expect("read dirty status");
        assert_eq!(dirty.changes.len(), 2);
        let diff =
            get_git_diff_impl(&canonical, Some("tracked.txt"), false).expect("read real git diff");
        assert!(diff.content.contains("-first"));
        assert!(diff.content.contains("+second"));

        fs::write(repository.join("tracked.txt"), "first\n").expect("restore tracked file");
        fs::remove_file(repository.join("untracked.txt")).expect("remove untracked file");
        let worktree = create_git_worktree_impl(&canonical, "phase6-test", true)
            .expect("create guarded worktree");
        assert!(PathBuf::from(&worktree.path).is_dir());
        assert!(!worktree.is_main);
        assert!(
            remove_git_worktree_impl(&canonical, canonical.to_string_lossy().as_ref()).is_err()
        );

        let dirty_file = PathBuf::from(&worktree.path).join("dirty.txt");
        fs::write(&dirty_file, "dirty\n").expect("dirty linked worktree");
        assert!(remove_git_worktree_impl(&canonical, &worktree.path).is_err());
        fs::remove_file(&dirty_file).expect("clean linked worktree");
        assert!(remove_git_worktree_impl(&canonical, &worktree.path)
            .expect("remove clean linked worktree"));
        assert!(!PathBuf::from(&worktree.path).exists());
        assert_eq!(
            list_git_worktrees_impl(&canonical)
                .expect("list remaining worktrees")
                .len(),
            1
        );
        fs::remove_dir_all(&root).expect("clean test root");
    }

    fn assert_native_terminal_round_trip(terminal: SpawnedTerminal) {
        let shell = terminal.shell.to_lowercase();
        let mut child = terminal.child;
        let mut writer = terminal.writer;
        let mut reader = terminal.reader;
        let master = terminal.master;
        let command = if cfg!(target_os = "windows") && shell == "cmd" {
            "echo __PI_PTY_OK__\r\nexit /B 0\r\n"
        } else if cfg!(target_os = "windows") {
            "Write-Output __PI_PTY_OK__; exit 0\r\n"
        } else {
            "printf '__PI_PTY_OK__\\n'; exit 0\n"
        };
        let (output_tx, output_rx) = mpsc::channel();
        let output_thread = thread::spawn(move || {
            let mut buffer = [0_u8; 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if output_tx.send(buffer[..count].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        let mut output = Vec::new();
        #[cfg(target_os = "windows")]
        {
            let dsr = b"\x1b[6n";
            let deadline = Instant::now() + Duration::from_secs(5);
            while !output.windows(dsr.len()).any(|window| window == dsr) {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match output_rx.recv_timeout(deadline.saturating_duration_since(now)) {
                    Ok(bytes) => output.extend_from_slice(&bytes),
                    Err(_) => break,
                }
            }
            if !output.windows(dsr.len()).any(|window| window == dsr) {
                let _ = child.kill();
                drop(writer);
                drop(master);
                output_thread.join().expect("join terminal output reader");
                while let Ok(bytes) = output_rx.try_recv() {
                    output.extend_from_slice(&bytes);
                }
                panic!(
                    "terminal shell {} did not request cursor position: {}",
                    shell,
                    String::from_utf8_lossy(&output)
                );
            }
            writer
                .write_all(b"\x1b[1;1R")
                .expect("answer terminal cursor-position probe");
        }
        writer
            .write_all(command.as_bytes())
            .and_then(|_| writer.flush())
            .expect("write terminal probe");

        let mut exit = None;
        for _ in 0..200 {
            if let Some(status) = child.try_wait().expect("poll terminal child") {
                exit = Some(status);
                break;
            }
            thread::sleep(Duration::from_millis(25));
        }
        if exit.is_none() {
            let _ = child.kill();
        }
        drop(writer);
        drop(master);
        output_thread.join().expect("join terminal output reader");
        while let Ok(bytes) = output_rx.try_recv() {
            output.extend_from_slice(&bytes);
        }
        let exit = exit.unwrap_or_else(|| {
            panic!(
                "terminal shell {} did not exit after probe: {}",
                shell,
                String::from_utf8_lossy(&output)
            )
        });
        assert!(
            exit.success(),
            "terminal shell {} exited with {}: {}",
            shell,
            exit.exit_code(),
            String::from_utf8_lossy(&output)
        );
        assert!(String::from_utf8_lossy(&output).contains("__PI_PTY_OK__"));
    }

    #[test]
    fn opens_a_real_native_terminal_pty() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create terminal test root");
        let terminal = spawn_terminal_process(&root, 100, 30).expect("spawn native terminal");
        assert_native_terminal_round_trip(terminal);
        fs::remove_dir_all(&root).expect("clean terminal test root");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn opens_a_real_native_cmd_terminal_pty() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create cmd terminal test root");
        let shell_path = which::which("cmd.exe").expect("locate cmd terminal fallback");
        let args = vec!["/Q".to_string()];
        let terminal = spawn_terminal_process_with_shell(&root, 100, 30, &shell_path, "cmd", &args)
            .expect("spawn cmd terminal fallback");
        assert_native_terminal_round_trip(terminal);
        fs::remove_dir_all(&root).expect("clean terminal test root");
    }

    #[test]
    fn auth_status_serializes_metadata_without_credential_values() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create auth test directory");
        let auth_file = root.join("auth.json");
        fs::write(
            &auth_file,
            r#"{"openai-codex":{"type":"oauth","access":"must-not-leak"},"deepseek":{"type":"api_key","key":"must-not-leak"}}"#,
        )
        .expect("write auth file");

        let statuses = auth_provider_statuses_from_file(&auth_file).expect("read auth metadata");
        let serialized = serde_json::to_string(&statuses).expect("serialize auth metadata");
        assert!(serialized.contains("openai-codex"));
        assert!(serialized.contains("auth_file_oauth"));
        assert!(!serialized.contains("must-not-leak"));
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn clears_only_the_requested_provider_from_an_isolated_auth_file() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create auth test directory");
        let auth_file = root.join("auth.json");
        fs::write(
            &auth_file,
            r#"{"deepseek":{"type":"api_key","key":"one"},"openai-codex":{"type":"oauth","access":"two"}}"#,
        )
        .expect("write auth file");

        assert!(clear_provider_auth_file(&auth_file, "deepseek").expect("clear provider"));
        let remaining: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&auth_file).expect("read updated auth file"))
                .expect("parse updated auth file");
        assert!(remaining.get("deepseek").is_none());
        assert_eq!(remaining["openai-codex"]["access"], "two");
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn malformed_auth_is_rejected_without_overwriting_the_file() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create auth test directory");
        let auth_file = root.join("auth.json");
        let malformed = "{not-json\n";
        fs::write(&auth_file, malformed).expect("write malformed auth file");

        let error = clear_provider_auth_file(&auth_file, "deepseek")
            .expect_err("malformed auth must be rejected");
        assert!(error.contains("Invalid JSON"));
        assert_eq!(
            fs::read_to_string(&auth_file).expect("read preserved auth file"),
            malformed
        );
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn non_object_auth_is_rejected_without_overwriting_the_file() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create auth test directory");
        let auth_file = root.join("auth.json");
        let non_object = "[]\n";
        fs::write(&auth_file, non_object).expect("write non-object auth file");

        let error = clear_provider_auth_file(&auth_file, "deepseek")
            .expect_err("non-object auth must be rejected");
        assert!(error.contains("must contain a JSON object"));
        assert_eq!(
            fs::read_to_string(&auth_file).expect("read preserved auth file"),
            non_object
        );
        fs::remove_dir_all(&root).expect("clean test root");
    }

    #[test]
    fn rejects_unsupported_provider_characters() {
        assert_eq!(
            normalize_auth_provider(" OpenAI-Codex ").expect("valid provider"),
            "openai-codex"
        );
        assert!(normalize_auth_provider("../openai").is_err());
        assert!(normalize_auth_provider("provider/name").is_err());
    }
}
