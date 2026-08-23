# Capability Model

Pi GUI exposes a small set of desktop capabilities around Pi. The source of truth is the typed React API plus registered Rust commands, not inherited donor documentation.

## Window and runtime information

The renderer may request desktop platform/version information and fixed window actions: minimize, maximize/restore, and close.

## Pi RPC

The Rust host starts and owns `pi --mode rpc` processes. The renderer can send one validated LF-delimited JSON record to an existing instance and can stop that owned instance. It cannot choose arbitrary child arguments or environment variables.

## Sessions

Native session operations are limited to the Pi session directory and selected workspace:

- list and filter session metadata;
- create/resume through a session-owned RPC runtime;
- rename, fork, and guarded delete;
- restore messages from real Pi JSONL.

Export, statistics, and tree/history overlays are not part of the current React renderer.

## Models and authentication

Live RPC provides models, thinking levels, and model switching. Rust exposes credential metadata only and a confirmed provider-scoped removal operation. Interactive login/logout remains in Pi TUI.

## Workspace files

The renderer receives only workspace-scoped commands:

- `list_workspace_directory`;
- `index_workspace_files`;
- `read_workspace_file`;
- `write_workspace_file`.

Canonical path checks reject traversal, generated directories and symlinks are skipped during browsing/indexing, text reads are size-bounded, and writes use stale-content conflict protection. There is no home-directory browser or general filesystem plugin.

## Terminal

One lazy xterm surface is backed by a Rust-owned native PTY. The renderer can start, write, resize, and stop only by the opaque terminal ID returned by Rust. Input sizes and dimensions are bounded, output is byte-safe, and application shutdown ends the process tree.

## Git and worktrees

Typed operations provide:

- repository status;
- bounded staged and unstaged diff;
- worktree listing;
- adjacent worktree creation for a validated branch;
- non-forced removal of an exact listed worktree.

The API does not expose arbitrary Git arguments, stage, commit, fetch, push, reset, force removal, or an unrestricted destination.

## Packages and resources

Typed Pi operations provide list, install, remove, and extension update. Sources and scopes are validated, output/time are bounded, mutations are serialized, and local sources must remain inside the selected workspace.

Project package settings require an explicit trust confirmation before Pi is called with project approval. Packages execute with full system access once Pi loads them.

Runtime extension, skill, and prompt commands come from live RPC `get_commands/sourceInfo`. Pi GUI displays them and stages `/<name>` in the composer; it does not auto-run them. Extension custom UI, package settings forms, a gallery, and recommendation policy are not implemented.

## Themes

The desktop shell has a persisted light/dark preference. Separately, the ecosystem view inventories Pi built-in and directly discovered user/project themes. It does not install, activate, or map Pi theme files onto the desktop shell.

## Managed runtime

The renderer may request fixed status, diagnostics, manual update check, confirmed install/update, activation/rollback, and system-mode selection. Rust fixes the release source, selects the platform asset, verifies SHA-256, validates extraction and executable version, owns process cleanup, and writes only below application data.

## Unsupported requests

An unavailable capability must produce a clear disabled state or error. Do not emulate unsupported Pi behavior with a hidden Node/Electron host, broaden a typed command into arbitrary arguments, or report an inherited donor feature as implemented.

When adding a capability, update `FEATURE_MAPPING.md`, `docs/PERMISSIONS.md`, tests, and release claims in the same change.
