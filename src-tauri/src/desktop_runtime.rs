use flate2::read::GzDecoder;
use fs2::FileExt;
use reqwest::blocking::{Client, Response};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PI_RELEASE_API: &str = "https://api.github.com/repos/earendil-works/pi/releases/latest";
const PI_RELEASE_DOWNLOAD_PREFIX: &str = "https://github.com/earendil-works/pi/releases/download/";
const RUNTIME_DIRECTORY: &str = "pi-runtime";
const MAX_RELEASE_METADATA_BYTES: usize = 2 * 1024 * 1024;
const MAX_RELEASE_NOTES_BYTES: usize = 64 * 1024;
const MAX_CHECKSUM_BYTES: usize = 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 768 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 20_000;
const MAX_RUNTIME_LOG_ENTRIES: usize = 200;
const MAX_RUNTIME_LOG_FILE_BYTES: u64 = 512 * 1024;
const MAX_LOG_DETAIL_BYTES: usize = 768;

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RuntimeMode {
    #[default]
    Managed,
    System,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default)]
pub(crate) struct RuntimeSettings {
    pub mode: RuntimeMode,
    pub system_pi_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct RuntimePointer {
    version: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct InstalledRuntimeManifest {
    version: String,
    executable: String,
    asset: String,
    sha256: String,
    installed_at: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct ManagedRuntime {
    pub version: String,
    pub executable: PathBuf,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct InstalledRuntimeInfo {
    pub version: String,
    pub executable: String,
    pub asset: String,
    pub sha256: String,
    pub installed_at: u64,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct RuntimeLogEntry {
    pub timestamp_ms: u64,
    pub level: String,
    pub event: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PiRuntimeStatus {
    pub mode: RuntimeMode,
    pub effective_source: String,
    pub managed: bool,
    pub fallback: bool,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub executable: Option<String>,
    pub system_pi_path: Option<String>,
    pub installed_versions: Vec<InstalledRuntimeInfo>,
    pub operation_active: bool,
    pub active_rpc_count: usize,
    pub note: Option<String>,
    pub release_notes: Option<String>,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct RuntimeDiagnostics {
    pub runtime_root: String,
    pub settings_path: String,
    pub log_path: String,
    pub active_rpc_count: usize,
    pub active_terminal_count: usize,
    pub operation_active: bool,
    pub installed_versions: Vec<InstalledRuntimeInfo>,
    pub logs: Vec<RuntimeLogEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct ManagedInstallResult {
    pub version: String,
    pub executable: String,
    pub already_installed: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct ReleaseSummary {
    pub version: String,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: Option<String>,
    asset: ReleaseAsset,
    checksums: ReleaseAsset,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    published_at: Option<String>,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone)]
struct ReleaseAsset {
    name: String,
    url: String,
}

#[derive(Clone)]
pub(crate) struct RuntimeLogger {
    entries: Arc<Mutex<VecDeque<RuntimeLogEntry>>>,
    log_path: Arc<Mutex<Option<PathBuf>>>,
}

pub(crate) struct DesktopRuntimeState {
    operation_active: Arc<AtomicBool>,
    shutdown_recorded: AtomicBool,
    logger: RuntimeLogger,
}

impl Default for DesktopRuntimeState {
    fn default() -> Self {
        Self {
            operation_active: Arc::new(AtomicBool::new(false)),
            shutdown_recorded: AtomicBool::new(false),
            logger: RuntimeLogger {
                entries: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_RUNTIME_LOG_ENTRIES))),
                log_path: Arc::new(Mutex::new(None)),
            },
        }
    }
}

pub(crate) struct RuntimeOperationGuard {
    active: Arc<AtomicBool>,
}

impl Drop for RuntimeOperationGuard {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

impl DesktopRuntimeState {
    pub fn initialize(&self, app: &AppHandle) {
        if let Ok(root) = runtime_root(app) {
            let cleaned = cleanup_abandoned_staging(&root);
            let path = root.join("runtime.log");
            if let Ok(mut slot) = self.logger.log_path.lock() {
                *slot = Some(path.clone());
            }
            self.logger.load_existing(&path);
            self.logger
                .record("info", "desktop_started", "Runtime manager ready");
            if cleaned > 0 {
                self.logger.record(
                    "info",
                    "runtime_staging_cleaned",
                    &format!(
                        "Removed {cleaned} abandoned runtime staging director{}",
                        if cleaned == 1 { "y" } else { "ies" }
                    ),
                );
            }
        }
    }

    pub fn logger(&self) -> RuntimeLogger {
        self.logger.clone()
    }

    pub fn is_operation_active(&self) -> bool {
        self.operation_active.load(Ordering::Acquire)
    }

    pub fn begin_operation(&self) -> Result<RuntimeOperationGuard, String> {
        self.operation_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "A Pi runtime operation is already in progress".to_string())?;
        Ok(RuntimeOperationGuard {
            active: self.operation_active.clone(),
        })
    }

    pub fn record_shutdown(&self) {
        if !self.shutdown_recorded.swap(true, Ordering::AcqRel) {
            self.logger.record(
                "info",
                "desktop_stopped",
                "Desktop runtime lifecycle stopped",
            );
        }
    }
}

impl RuntimeLogger {
    pub fn record(&self, level: &str, event: &str, detail: &str) {
        let entry = RuntimeLogEntry {
            timestamp_ms: unix_time_millis(),
            level: sanitize_log_value(level, 16),
            event: sanitize_log_value(event, 64),
            detail: sanitize_log_value(detail, MAX_LOG_DETAIL_BYTES),
        };

        if let Ok(mut entries) = self.entries.lock() {
            push_bounded_log(&mut entries, entry.clone());
        }
        self.append_to_file(&entry);
    }

    pub fn entries(&self) -> Vec<RuntimeLogEntry> {
        self.entries
            .lock()
            .map(|entries| entries.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn load_existing(&self, path: &Path) {
        let Ok(content) = fs::read_to_string(path) else {
            return;
        };
        if let Ok(mut entries) = self.entries.lock() {
            for line in content.lines() {
                if let Ok(entry) = serde_json::from_str::<RuntimeLogEntry>(line) {
                    push_bounded_log(&mut entries, entry);
                }
            }
        }
    }

    fn append_to_file(&self, entry: &RuntimeLogEntry) {
        let path = self
            .log_path
            .lock()
            .ok()
            .and_then(|path| path.as_ref().cloned());
        let Some(path) = path else {
            return;
        };
        let Some(parent) = path.parent() else {
            return;
        };
        if fs::create_dir_all(parent).is_err() {
            return;
        }

        if fs::metadata(&path)
            .map(|metadata| metadata.len() >= MAX_RUNTIME_LOG_FILE_BYTES)
            .unwrap_or(false)
        {
            let rotated = path.with_extension("log.old");
            let _ = fs::remove_file(&rotated);
            let _ = fs::rename(&path, rotated);
        }

        let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
            return;
        };
        if let Ok(line) = serde_json::to_string(entry) {
            let _ = file.write_all(line.as_bytes());
            let _ = file.write_all(b"\n");
        }
    }
}

fn push_bounded_log(entries: &mut VecDeque<RuntimeLogEntry>, entry: RuntimeLogEntry) {
    if entries.len() >= MAX_RUNTIME_LOG_ENTRIES {
        entries.pop_front();
    }
    entries.push_back(entry);
}

fn sanitize_log_value(value: &str, max_bytes: usize) -> String {
    let single_line = value.replace(['\r', '\n', '\0'], " ");
    truncate_utf8(&single_line, max_bytes)
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

fn unix_time_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

pub(crate) fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(RUNTIME_DIRECTORY))
        .map_err(|error| format!("Failed to resolve the desktop app data directory: {error}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("settings.json"))
}

pub(crate) fn load_settings(app: &AppHandle) -> Result<RuntimeSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(RuntimeSettings::default());
    }
    read_json(&path, "runtime settings")
}

pub(crate) fn save_settings(
    app: &AppHandle,
    mode: RuntimeMode,
    system_pi_path: Option<String>,
) -> Result<RuntimeSettings, String> {
    let normalized_path = system_pi_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    if normalized_path
        .as_ref()
        .map(|path| path.len() > 4096 || path.contains('\0'))
        .unwrap_or(false)
    {
        return Err("The configured system Pi path is invalid".to_string());
    }
    let settings = RuntimeSettings {
        mode,
        system_pi_path: normalized_path,
    };
    write_json_transactional(&settings_path(app)?, &settings)?;
    Ok(settings)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<T, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {label} at {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {label} at {}: {error}", path.display()))
}

fn write_json_transactional<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Invalid settings path: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("runtime"),
        unix_time_millis()
    ));
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to serialize runtime metadata: {error}"))?;
    {
        let mut file = File::create(&temporary)
            .map_err(|error| format!("Failed to create {}: {error}", temporary.display()))?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Failed to write {}: {error}", temporary.display()))?;
    }

    let backup = path.with_extension("backup");
    let had_existing = path.exists();
    if had_existing {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup).map_err(|error| {
            format!(
                "Failed to prepare {} for replacement: {error}",
                path.display()
            )
        })?;
    }
    match fs::rename(&temporary, path) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            if had_existing {
                let _ = fs::rename(&backup, path);
            }
            Err(format!("Failed to activate {}: {error}", path.display()))
        }
    }
}

fn is_safe_relative_path(path: &Path) -> bool {
    path.components().next().is_some()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn versions_root(root: &Path) -> PathBuf {
    root.join("versions")
}

fn cleanup_abandoned_staging(root: &Path) -> usize {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let mut cleaned = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let is_staging = entry
            .file_name()
            .to_str()
            .map(|name| name.starts_with(".install-"))
            .unwrap_or(false)
            && path.is_dir();
        if !is_staging {
            continue;
        }
        let lock_path = path.join("owner.lock");
        let removable = if lock_path.exists() {
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(&lock_path)
                .ok()
                .map(|file| FileExt::try_lock_exclusive(&file).is_ok())
                .unwrap_or(false)
        } else {
            true
        };
        if removable && fs::remove_dir_all(&path).is_ok() {
            cleaned += 1;
        }
    }
    cleaned
}

fn version_directory(root: &Path, version: &str) -> Result<PathBuf, String> {
    Version::parse(version).map_err(|_| format!("Invalid Pi runtime version: {version}"))?;
    Ok(versions_root(root).join(version))
}

fn load_installed_manifest(
    root: &Path,
    version: &str,
) -> Result<(InstalledRuntimeManifest, PathBuf), String> {
    let directory = version_directory(root, version)?;
    let manifest: InstalledRuntimeManifest = read_json(
        &directory.join("manifest.json"),
        "installed runtime manifest",
    )?;
    if manifest.version != version || !is_safe_relative_path(Path::new(&manifest.executable)) {
        return Err(format!(
            "Invalid managed runtime manifest for version {version}"
        ));
    }
    let executable = directory.join(&manifest.executable);
    if !executable.is_file() {
        return Err(format!(
            "Managed Pi {version} is incomplete: {} is missing",
            executable.display()
        ));
    }
    Ok((manifest, executable))
}

fn read_current_pointer(root: &Path) -> Result<Option<RuntimePointer>, String> {
    let path = root.join("current.json");
    if !path.exists() {
        return Ok(None);
    }
    read_json(&path, "managed runtime pointer").map(Some)
}

pub(crate) fn resolve_managed_runtime(app: &AppHandle) -> Result<Option<ManagedRuntime>, String> {
    let root = runtime_root(app)?;
    let Some(pointer) = read_current_pointer(&root)? else {
        return Ok(None);
    };
    let (_, executable) = load_installed_manifest(&root, &pointer.version)?;
    Ok(Some(ManagedRuntime {
        version: pointer.version,
        executable,
    }))
}

fn activate_version(root: &Path, version: &str) -> Result<PathBuf, String> {
    let (_, executable) = load_installed_manifest(root, version)?;
    if let Some(current) = read_current_pointer(root)? {
        if current.version != version {
            write_json_transactional(&root.join("previous.json"), &current)?;
        }
    }
    write_json_transactional(
        &root.join("current.json"),
        &RuntimePointer {
            version: version.to_string(),
        },
    )?;
    Ok(executable)
}

pub(crate) fn list_installed_runtimes(
    app: &AppHandle,
) -> Result<Vec<InstalledRuntimeInfo>, String> {
    let root = runtime_root(app)?;
    list_installed_runtimes_at(&root)
}

fn list_installed_runtimes_at(root: &Path) -> Result<Vec<InstalledRuntimeInfo>, String> {
    let current = read_current_pointer(root)?.map(|pointer| pointer.version);
    let directory = versions_root(root);
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let mut runtimes = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read {}: {error}", directory.display()))?
    {
        let Ok(entry) = entry else {
            continue;
        };
        let Some(version) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Ok((manifest, executable)) = load_installed_manifest(root, &version) else {
            continue;
        };
        runtimes.push(InstalledRuntimeInfo {
            current: current.as_deref() == Some(version.as_str()),
            version: manifest.version,
            executable: executable.to_string_lossy().to_string(),
            asset: manifest.asset,
            sha256: manifest.sha256,
            installed_at: manifest.installed_at,
        });
    }
    runtimes.sort_by(|left, right| {
        let left_version = Version::parse(&left.version).ok();
        let right_version = Version::parse(&right.version).ok();
        right_version
            .cmp(&left_version)
            .then_with(|| right.version.cmp(&left.version))
    });
    Ok(runtimes)
}

pub(crate) fn activate_installed_runtime(
    app: &AppHandle,
    version: &str,
    logger: &RuntimeLogger,
) -> Result<ManagedInstallResult, String> {
    let root = runtime_root(app)?;
    let executable = activate_version(&root, version)?;
    logger.record(
        "info",
        "runtime_rollback",
        &format!("Activated managed Pi {version}"),
    );
    Ok(ManagedInstallResult {
        version: version.to_string(),
        executable: executable.to_string_lossy().to_string(),
        already_installed: true,
    })
}

fn release_asset_name(os: &str, arch: &str) -> Result<String, String> {
    let architecture = match arch {
        "x86_64" | "x64" | "amd64" => "x64",
        "aarch64" | "arm64" => "arm64",
        _ => return Err(format!("Managed Pi does not support architecture {arch}")),
    };
    let name = match os {
        "windows" => format!("pi-windows-{architecture}.zip"),
        "macos" => format!("pi-darwin-{architecture}.tar.gz"),
        "linux" => format!("pi-linux-{architecture}.tar.gz"),
        _ => return Err(format!("Managed Pi does not support platform {os}")),
    };
    Ok(name)
}

fn http_client() -> Result<Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .user_agent(format!(
            "Pi-GUI/{} (managed-runtime)",
            env!("CARGO_PKG_VERSION")
        ))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| format!("Failed to initialize the runtime downloader: {error}"))
}

fn response_with_success(response: Response, label: &str) -> Result<Response, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{label} returned HTTP {status}"));
    }
    Ok(response)
}

fn read_response_capped(
    mut response: Response,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .map(|length| length > max_bytes as u64)
        .unwrap_or(false)
    {
        return Err(format!("{label} exceeds the {max_bytes}-byte limit"));
    }
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Failed to read {label}: {error}"))?;
        if read == 0 {
            break;
        }
        if bytes.len().saturating_add(read) > max_bytes {
            return Err(format!("{label} exceeds the {max_bytes}-byte limit"));
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    Ok(bytes)
}

fn validate_official_asset(asset: &GithubReleaseAsset) -> Result<ReleaseAsset, String> {
    if !asset
        .browser_download_url
        .starts_with(PI_RELEASE_DOWNLOAD_PREFIX)
    {
        return Err(format!(
            "Release asset {} does not use the official Pi download location",
            asset.name
        ));
    }
    Ok(ReleaseAsset {
        name: asset.name.clone(),
        url: asset.browser_download_url.clone(),
    })
}

pub(crate) fn fetch_latest_release() -> Result<ReleaseSummary, String> {
    let client = http_client()?;
    let response = client
        .get(PI_RELEASE_API)
        .send()
        .map_err(|error| format!("Failed to query the official Pi release: {error}"))?;
    let response = response_with_success(response, "The official Pi release API")?;
    let bytes = read_response_capped(response, MAX_RELEASE_METADATA_BYTES, "release metadata")?;
    let release: GithubRelease = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Failed to parse official Pi release metadata: {error}"))?;
    let version_text = release.tag_name.trim().trim_start_matches('v');
    let version = Version::parse(version_text)
        .map_err(|_| {
            format!(
                "The official release tag is not a valid version: {}",
                release.tag_name
            )
        })?
        .to_string();
    let expected_asset = release_asset_name(std::env::consts::OS, std::env::consts::ARCH)?;
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == expected_asset)
        .ok_or_else(|| format!("The official Pi release does not contain {expected_asset}"))?;
    let checksums = release
        .assets
        .iter()
        .find(|asset| asset.name == "SHA256SUMS")
        .ok_or_else(|| "The official Pi release does not contain SHA256SUMS".to_string())?;

    Ok(ReleaseSummary {
        version,
        release_notes: truncate_utf8(
            release
                .body
                .as_deref()
                .unwrap_or("No release notes provided."),
            MAX_RELEASE_NOTES_BYTES,
        ),
        release_url: release.html_url,
        published_at: release.published_at,
        asset: validate_official_asset(asset)?,
        checksums: validate_official_asset(checksums)?,
    })
}

pub(crate) fn is_newer_release(latest: &str, current: &str) -> bool {
    match (Version::parse(latest), Version::parse(current)) {
        (Ok(latest), Ok(current)) => latest > current,
        _ => false,
    }
}

fn parse_sha256sums(content: &str, asset_name: &str) -> Result<String, String> {
    for line in content.lines() {
        let mut parts = line.split_whitespace();
        let Some(hash) = parts.next() else {
            continue;
        };
        let Some(name) = parts.next() else {
            continue;
        };
        let normalized_name = name.trim_start_matches('*');
        if normalized_name == asset_name
            && hash.len() == 64
            && hash.chars().all(|character| character.is_ascii_hexdigit())
        {
            return Ok(hash.to_ascii_lowercase());
        }
    }
    Err(format!(
        "SHA256SUMS does not contain a valid hash for {asset_name}"
    ))
}

fn download_checksum(client: &Client, asset: &ReleaseAsset) -> Result<String, String> {
    let response = client
        .get(&asset.url)
        .send()
        .map_err(|error| format!("Failed to download SHA256SUMS: {error}"))?;
    let response = response_with_success(response, "SHA256SUMS download")?;
    let bytes = read_response_capped(response, MAX_CHECKSUM_BYTES, "SHA256SUMS")?;
    String::from_utf8(bytes).map_err(|_| "SHA256SUMS is not valid UTF-8".to_string())
}

fn download_archive(
    client: &Client,
    asset: &ReleaseAsset,
    destination: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let response = client
        .get(&asset.url)
        .send()
        .map_err(|error| format!("Failed to download {}: {error}", asset.name))?;
    let mut response = response_with_success(response, "Pi runtime download")?;
    if response
        .content_length()
        .map(|length| length > MAX_ARCHIVE_BYTES)
        .unwrap_or(false)
    {
        return Err(format!("{} exceeds the managed download limit", asset.name));
    }
    let mut output = File::create(destination)
        .map_err(|error| format!("Failed to create {}: {error}", destination.display()))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Failed while downloading {}: {error}", asset.name))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > MAX_ARCHIVE_BYTES {
            return Err(format!("{} exceeds the managed download limit", asset.name));
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("Failed to write {}: {error}", destination.display()))?;
        hasher.update(&buffer[..read]);
    }
    output
        .sync_all()
        .map_err(|error| format!("Failed to flush {}: {error}", destination.display()))?;
    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "Checksum verification failed for {} (expected {}, got {})",
            asset.name, expected_sha256, actual
        ));
    }
    Ok(())
}

fn safe_archive_destination(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if !is_safe_relative_path(relative) {
        return Err(format!(
            "Archive contains an unsafe path: {}",
            relative.display()
        ));
    }
    Ok(root.join(relative))
}

fn extract_zip(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive_path)
        .map_err(|error| format!("Failed to open {}: {error}", archive_path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Failed to read {}: {error}", archive_path.display()))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("Pi runtime archive contains too many entries".to_string());
    }
    let mut extracted_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read ZIP entry {index}: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("ZIP entry contains an unsafe path: {}", entry.name()))?;
        let destination_path = safe_archive_destination(destination, &relative)?;
        if entry
            .unix_mode()
            .map(|mode| mode & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            return Err(format!("ZIP entry is a symbolic link: {}", entry.name()));
        }
        if entry.is_dir() {
            fs::create_dir_all(&destination_path).map_err(|error| {
                format!("Failed to create {}: {error}", destination_path.display())
            })?;
            continue;
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err("Pi runtime archive exceeds the extraction limit".to_string());
        }
        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        }
        let mut output = File::create(&destination_path)
            .map_err(|error| format!("Failed to create {}: {error}", destination_path.display()))?;
        io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Failed to extract {}: {error}", entry.name()))?;
    }
    Ok(())
}

fn extract_tar_gz(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive_path)
        .map_err(|error| format!("Failed to open {}: {error}", archive_path.display()))?;
    let decoder = GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|error| format!("Failed to read {}: {error}", archive_path.display()))?;
    let mut entry_count = 0_usize;
    let mut extracted_bytes = 0_u64;
    for entry in entries {
        entry_count += 1;
        if entry_count > MAX_ARCHIVE_ENTRIES {
            return Err("Pi runtime archive contains too many entries".to_string());
        }
        let mut entry = entry.map_err(|error| format!("Failed to read TAR entry: {error}"))?;
        let relative = entry
            .path()
            .map_err(|error| format!("Failed to read TAR path: {error}"))?
            .into_owned();
        let destination_path = safe_archive_destination(destination, &relative)?;
        let entry_type = entry.header().entry_type();
        if entry_type.is_dir() {
            fs::create_dir_all(&destination_path).map_err(|error| {
                format!("Failed to create {}: {error}", destination_path.display())
            })?;
            continue;
        }
        if !entry_type.is_file() {
            return Err(format!(
                "TAR entry is not a regular file: {}",
                relative.display()
            ));
        }
        let size = entry
            .header()
            .size()
            .map_err(|error| format!("Failed to read TAR entry size: {error}"))?;
        extracted_bytes = extracted_bytes.saturating_add(size);
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err("Pi runtime archive exceeds the extraction limit".to_string());
        }
        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        }
        let mut output = File::create(&destination_path)
            .map_err(|error| format!("Failed to create {}: {error}", destination_path.display()))?;
        io::copy(&mut entry, &mut output).map_err(|error| {
            format!("Failed to extract {}: {error}", destination_path.display())
        })?;
        #[cfg(unix)]
        if let Ok(mode) = entry.header().mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&destination_path, fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

fn find_runtime_binary(root: &Path) -> Result<PathBuf, String> {
    let expected = if cfg!(target_os = "windows") {
        "pi.exe"
    } else {
        "pi"
    };
    let mut pending = vec![root.to_path_buf()];
    let mut candidates = Vec::new();
    let mut visited = 0_usize;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?
        {
            let entry =
                entry.map_err(|error| format!("Failed to inspect runtime entry: {error}"))?;
            visited += 1;
            if visited > MAX_ARCHIVE_ENTRIES {
                return Err("Extracted Pi runtime contains too many entries".to_string());
            }
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
                format!("Failed to inspect {}: {error}", entry.path().display())
            })?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Extracted Pi runtime contains a symbolic link: {}",
                    entry.path().display()
                ));
            }
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file()
                && entry
                    .file_name()
                    .to_str()
                    .map(|name| name.eq_ignore_ascii_case(expected))
                    .unwrap_or(false)
            {
                candidates.push(entry.path());
            }
        }
    }
    candidates.sort_by_key(|path| path.components().count());
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| format!("The official archive does not contain {expected}"))
}

fn read_pipe_capped<R: Read>(mut reader: R, max_bytes: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    while bytes.len() < max_bytes {
        let remaining = max_bytes - bytes.len();
        let chunk_size = buffer.len().min(remaining);
        match reader.read(&mut buffer[..chunk_size]) {
            Ok(0) | Err(_) => break,
            Ok(read) => bytes.extend_from_slice(&buffer[..read]),
        }
    }
    bytes
}

pub(crate) fn version_at_path(path: &Path) -> Result<String, String> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run {} --version: {error}", path.display()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Pi version output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Pi version error output".to_string())?;
    let stdout_reader = std::thread::spawn(move || read_pipe_capped(stdout, 64 * 1024));
    let stderr_reader = std::thread::spawn(move || read_pipe_capped(stderr, 64 * 1024));
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{} --version timed out", path.display()));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed to wait for {}: {error}", path.display()));
            }
        }
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("{} --version exited with {status}", path.display()));
    }
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    );
    for raw in combined.split_whitespace() {
        let token = raw
            .trim_matches(|character: char| {
                !(character.is_ascii_alphanumeric() || character == '.' || character == '-')
            })
            .trim_start_matches('v');
        if let Ok(version) = Version::parse(token) {
            return Ok(version.to_string());
        }
    }
    Err(format!(
        "{} did not return a valid Pi version",
        path.display()
    ))
}

pub(crate) fn install_latest_runtime(
    app: &AppHandle,
    logger: &RuntimeLogger,
) -> Result<ManagedInstallResult, String> {
    install_latest_runtime_at(&runtime_root(app)?, logger)
}

fn install_latest_runtime_at(
    root: &Path,
    logger: &RuntimeLogger,
) -> Result<ManagedInstallResult, String> {
    logger.record(
        "info",
        "runtime_install_started",
        "Checking the official Pi release",
    );
    let release = fetch_latest_release()?;
    fs::create_dir_all(versions_root(root))
        .map_err(|error| format!("Failed to create managed runtime directory: {error}"))?;

    if let Ok((manifest, executable)) = load_installed_manifest(root, &release.version) {
        let actual_version = version_at_path(&executable)?;
        if actual_version != release.version || manifest.version != release.version {
            return Err(format!(
                "Existing managed Pi {} failed version verification",
                release.version
            ));
        }
        activate_version(root, &release.version)?;
        logger.record(
            "info",
            "runtime_activated",
            &format!("Activated existing managed Pi {}", release.version),
        );
        return Ok(ManagedInstallResult {
            version: release.version,
            executable: executable.to_string_lossy().to_string(),
            already_installed: true,
        });
    }

    let client = http_client()?;
    let checksum_text = download_checksum(&client, &release.checksums)?;
    let expected_sha256 = parse_sha256sums(&checksum_text, &release.asset.name)?;
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(root)
        .map_err(|error| format!("Failed to create runtime staging directory: {error}"))?;
    let staging_lock = OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .open(staging.path().join("owner.lock"))
        .map_err(|error| format!("Failed to create runtime staging lock: {error}"))?;
    FileExt::try_lock_exclusive(&staging_lock)
        .map_err(|error| format!("Failed to lock runtime staging directory: {error}"))?;
    let archive_path = staging.path().join(&release.asset.name);
    download_archive(&client, &release.asset, &archive_path, &expected_sha256)?;
    logger.record(
        "info",
        "runtime_download_verified",
        &format!("Verified {} for Pi {}", release.asset.name, release.version),
    );

    let extracted = staging.path().join("extracted");
    fs::create_dir_all(&extracted)
        .map_err(|error| format!("Failed to create extraction directory: {error}"))?;
    if release.asset.name.ends_with(".zip") {
        extract_zip(&archive_path, &extracted)?;
    } else if release.asset.name.ends_with(".tar.gz") {
        extract_tar_gz(&archive_path, &extracted)?;
    } else {
        return Err(format!(
            "Unsupported Pi runtime archive: {}",
            release.asset.name
        ));
    }
    let executable = find_runtime_binary(&extracted)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).map_err(|error| {
            format!(
                "Failed to mark {} executable: {error}",
                executable.display()
            )
        })?;
    }
    let actual_version = version_at_path(&executable)?;
    if actual_version != release.version {
        return Err(format!(
            "Downloaded Pi version mismatch: expected {}, got {}",
            release.version, actual_version
        ));
    }
    let executable_relative = executable
        .strip_prefix(&extracted)
        .map_err(|_| "Extracted Pi executable escaped the staging directory".to_string())?;
    if !is_safe_relative_path(executable_relative) {
        return Err("Extracted Pi executable path is unsafe".to_string());
    }
    let manifest = InstalledRuntimeManifest {
        version: release.version.clone(),
        executable: executable_relative.to_string_lossy().to_string(),
        asset: release.asset.name,
        sha256: expected_sha256,
        installed_at: unix_time_secs(),
    };
    fs::write(
        extracted.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Failed to serialize runtime manifest: {error}"))?,
    )
    .map_err(|error| format!("Failed to write runtime manifest: {error}"))?;

    let final_directory = version_directory(root, &release.version)?;
    if final_directory.exists() {
        return Err(format!(
            "Managed runtime directory already exists but is invalid: {}",
            final_directory.display()
        ));
    }
    fs::rename(&extracted, &final_directory)
        .map_err(|error| format!("Failed to commit managed Pi {}: {error}", release.version))?;
    let executable = activate_version(root, &release.version)?;
    logger.record(
        "info",
        "runtime_install_completed",
        &format!("Installed and activated managed Pi {}", release.version),
    );
    Ok(ManagedInstallResult {
        version: release.version,
        executable: executable.to_string_lossy().to_string(),
        already_installed: false,
    })
}

pub(crate) fn diagnostics(
    app: &AppHandle,
    state: &DesktopRuntimeState,
    active_rpc_count: usize,
    active_terminal_count: usize,
) -> Result<RuntimeDiagnostics, String> {
    let root = runtime_root(app)?;
    Ok(RuntimeDiagnostics {
        runtime_root: root.to_string_lossy().to_string(),
        settings_path: settings_path(app)?.to_string_lossy().to_string(),
        log_path: root.join("runtime.log").to_string_lossy().to_string(),
        active_rpc_count,
        active_terminal_count,
        operation_active: state.is_operation_active(),
        installed_versions: list_installed_runtimes_at(&root)?,
        logs: state.logger.entries(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_installed(root: &Path, version: &str) {
        let directory = versions_root(root).join(version);
        fs::create_dir_all(&directory).expect("create version directory");
        let executable_name = if cfg!(target_os = "windows") {
            "pi.exe"
        } else {
            "pi"
        };
        fs::write(directory.join(executable_name), b"test").expect("write test binary");
        fs::write(
            directory.join("manifest.json"),
            serde_json::to_vec(&InstalledRuntimeManifest {
                version: version.to_string(),
                executable: executable_name.to_string(),
                asset: "test.zip".to_string(),
                sha256: "a".repeat(64),
                installed_at: 1,
            })
            .expect("serialize manifest"),
        )
        .expect("write manifest");
    }

    #[test]
    fn maps_supported_official_release_assets() {
        assert_eq!(
            release_asset_name("windows", "x86_64").expect("Windows x64"),
            "pi-windows-x64.zip"
        );
        assert_eq!(
            release_asset_name("macos", "aarch64").expect("macOS arm64"),
            "pi-darwin-arm64.tar.gz"
        );
        assert_eq!(
            release_asset_name("linux", "x86_64").expect("Linux x64"),
            "pi-linux-x64.tar.gz"
        );
        assert!(release_asset_name("windows", "x86").is_err());
    }

    #[test]
    fn parses_only_the_exact_checksum_asset() {
        let content = format!(
            "{}  pi-windows-x64.zip\n{} *pi-linux-x64.tar.gz\n",
            "a".repeat(64),
            "b".repeat(64)
        );
        assert_eq!(
            parse_sha256sums(&content, "pi-windows-x64.zip").expect("checksum"),
            "a".repeat(64)
        );
        assert!(parse_sha256sums(&content, "pi-windows-arm64.zip").is_err());
    }

    #[test]
    fn rejects_archive_path_traversal_and_absolute_paths() {
        assert!(safe_archive_destination(Path::new("root"), Path::new("pi/bin/pi")).is_ok());
        assert!(safe_archive_destination(Path::new("root"), Path::new("../pi.exe")).is_err());
        assert!(safe_archive_destination(Path::new("root"), Path::new("/pi.exe")).is_err());
    }

    #[test]
    fn activation_preserves_previous_version_for_rollback() {
        let temporary = tempfile::tempdir().expect("temporary runtime root");
        create_installed(temporary.path(), "0.83.0");
        create_installed(temporary.path(), "0.84.2");
        activate_version(temporary.path(), "0.83.0").expect("activate old version");
        activate_version(temporary.path(), "0.84.2").expect("activate new version");

        let current: RuntimePointer =
            read_json(&temporary.path().join("current.json"), "current").expect("current pointer");
        let previous: RuntimePointer =
            read_json(&temporary.path().join("previous.json"), "previous")
                .expect("previous pointer");
        assert_eq!(current.version, "0.84.2");
        assert_eq!(previous.version, "0.83.0");
    }

    #[test]
    fn runtime_logs_are_bounded_and_single_line() {
        let logger = RuntimeLogger {
            entries: Arc::new(Mutex::new(VecDeque::new())),
            log_path: Arc::new(Mutex::new(None)),
        };
        for index in 0..(MAX_RUNTIME_LOG_ENTRIES + 5) {
            logger.record("info", "test", &format!("entry {index}\nnext"));
        }
        let entries = logger.entries();
        assert_eq!(entries.len(), MAX_RUNTIME_LOG_ENTRIES);
        assert_eq!(entries.first().expect("first entry").detail, "entry 5 next");
        assert!(!entries.last().expect("last entry").detail.contains('\n'));
    }

    #[test]
    fn cleans_only_unlocked_runtime_staging_directories() {
        let temporary = tempfile::tempdir().expect("temporary runtime root");
        let abandoned = temporary.path().join(".install-abandoned");
        let active = temporary.path().join(".install-active");
        let version = temporary.path().join("versions").join("0.84.2");
        fs::create_dir_all(&abandoned).expect("create abandoned staging");
        fs::create_dir_all(&active).expect("create active staging");
        fs::create_dir_all(&version).expect("create version directory");
        let active_lock = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(active.join("owner.lock"))
            .expect("create active lock");
        FileExt::try_lock_exclusive(&active_lock).expect("lock active staging");

        assert_eq!(cleanup_abandoned_staging(temporary.path()), 1);
        assert!(!abandoned.exists());
        assert!(active.exists());
        assert!(version.exists());
    }

    #[test]
    #[ignore = "downloads and executes the latest official Pi release"]
    fn installs_and_reuses_an_official_runtime_in_isolation() {
        let temporary = tempfile::tempdir().expect("temporary runtime gate root");
        let logger = RuntimeLogger {
            entries: Arc::new(Mutex::new(VecDeque::new())),
            log_path: Arc::new(Mutex::new(None)),
        };

        let installed = install_latest_runtime_at(temporary.path(), &logger)
            .expect("install official managed runtime");
        assert!(!installed.already_installed);
        assert_eq!(
            version_at_path(Path::new(&installed.executable)).expect("run managed Pi --version"),
            installed.version
        );
        let current: RuntimePointer = read_json(
            &temporary.path().join("current.json"),
            "managed runtime pointer",
        )
        .expect("read current pointer");
        assert_eq!(current.version, installed.version);

        let reused = install_latest_runtime_at(temporary.path(), &logger)
            .expect("reuse verified managed runtime");
        assert!(reused.already_installed);
        assert_eq!(reused.version, installed.version);
    }
}
