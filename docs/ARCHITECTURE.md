# Architecture

This document describes the shipped React/Tauri architecture for the Pi GUI `0.1.0` candidate.

## System shape

```text
React 19 renderer
  -> typed desktopApi / PiAdapter
    -> Tauri invoke + events
      -> Rust host
        -> pi --mode rpc
        -> native PTY
        -> bounded filesystem and Git operations
        -> managed Pi runtime lifecycle
```

Pi remains the agent runtime and owns model execution, tool execution, session semantics, authentication, and package behavior. Pi GUI owns desktop presentation, process lifecycle, and narrow native operations.

## React renderer

The renderer provides:

- native-looking window shell, theme persistence, workspace selection, and tool panels;
- per-session message/model/activity snapshots;
- JSONL RPC request correlation and event normalization;
- file, Git, terminal, package, and runtime views backed by typed APIs.

It does not receive Node.js, Electron, general shell, general Git, or arbitrary filesystem APIs. `src/api/desktop-api.ts` is the frontend boundary; it does not expose arbitrary command arguments or environment variables.

## Rust/Tauri host

The Rust host owns every privileged operation:

- Pi RPC child creation, stdin/stdout JSONL transport, generation IDs, and process-tree cleanup;
- workspace canonicalization and bounded file reads/writes;
- native PTY start/write/resize/stop;
- fixed Git status/diff/worktree operations;
- typed Pi package operations;
- authentication metadata normalization and guarded credential removal;
- managed runtime discovery, verified installation, activation, rollback, recovery, diagnostics, and logs.

Tauri capabilities are declared in `src-tauri/capabilities/default.json`. Renderer shell process grants are absent.

## Session and RPC design

Each loaded session has its own Pi RPC process. The frontend tracks a stable session runtime record, while Rust assigns an instance ID and generation so late events from an old process cannot mutate a replacement runtime.

A monotonic selection guard makes the latest workspace/session selection win. Message, activity, model, and thinking state stay attached to that session. Disconnect, panel shutdown, window close, and application exit drain owned RPC/PTY/package child processes.

RPC transport is strict LF-delimited JSONL. After Rust spawns Pi, the adapter waits for a real correlated `get_state` response before exposing the session as ready; configured package initialization can therefore finish without racing the first user action. The adapter handles delta-only message updates, authoritative message-end reconciliation, tool lifecycle events, abort, and the steer/follow-up gate without a mock agent.

## Data ownership

| Data | Owner |
| --- | --- |
| Pi sessions and authentication | Pi's local data directories |
| Selected workspace and light/dark shell preference | WebView local storage |
| Managed Pi versions, runtime settings, and lifecycle logs | Pi GUI application data |
| Open-session UI snapshots | React memory |
| Workspace files and Git repository | User-selected workspace |

Credential values, prompts, model output, and environment variables are excluded from runtime diagnostics and lifecycle logs.

Native acceptance tests set `PI_CODING_AGENT_DIR` for Pi sessions/configuration and may set `PI_GUI_DATA_DIR` to an absolute, non-root disposable directory without parent components so Rust app data does not touch the normal profile. Windows tests also set WebView2's `WEBVIEW2_USER_DATA_FOLDER` to a disposable directory. These are host-side test-isolation controls, not renderer capabilities or normal user configuration.

## Models and authentication

Models and thinking levels come from live Pi RPC. Full model records are normalized before entering React state; provider headers, endpoints, and credential values are discarded.

Rust exposes only provider/source/credential-kind metadata. Credential removal is provider-scoped, confirmed, and preserves a malformed auth file instead of overwriting it. Interactive login remains in Pi TUI because Pi 0.84.2 does not expose login over RPC.

## Packages and runtime resources

Package list/install/remove/update delegates to the Pi CLI through fixed Rust commands. Project package settings are hidden until the user explicitly approves that workspace; package mutations warn that Pi packages execute with full system access.

The active Pi RPC process supplies extension, skill, and prompt commands through `get_commands`. Pi GUI groups and stages those commands in the composer. It does not currently host extension custom UI requests, package configuration forms, or a recommendation gallery.

## Managed runtime

Managed mode resolves, in order:

1. a verified app-owned version;
2. a packaged sidecar, if present;
3. an existing system Pi as a non-mutating fallback.

Update checks are manual. Installation accepts only the exact platform asset from the fixed Pi release source, checks the published SHA-256, constrains archive extraction, validates `pi --version`, and transactionally switches the active version. It never changes global npm packages or `PATH`.

Runtime maintenance is serialized and refused while RPC sessions are active. Previous verified versions remain available for rollback, and abandoned staging directories are recovered only when their owner lock is no longer active.

## Security and product boundary

Pi GUI intentionally excludes Electron main/preload/agent-host code, Browser Agent, Channels, unrestricted shell execution, arbitrary Git commands, general renderer filesystem access, and silent runtime updates.

Destructive or trust-changing renderer actions use awaited Tauri-native confirmation dialogs. A dialog failure resolves as cancellation, so a WebView modal quirk cannot execute the action early.

See `docs/PERMISSIONS.md` for the native authority boundary and `FEATURE_MAPPING.md` for the exact implemented/unsupported feature list.
