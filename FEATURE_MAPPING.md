# Pi CLI → Pi GUI Feature Mapping

This document describes the code that exists on `feat/tauri-react-migration` after Phase 8 and the first release-preparation pass. It intentionally does not count inherited Gustav UI claims that are not present in the React renderer.

## Foundation

| Pi capability | Desktop status |
| --- | --- |
| `pi --mode rpc` JSONL protocol | ✅ Rust owns one process per loaded session; the React `PiAdapter` correlates strict LF-delimited requests and events. |
| Pi discovery | ✅ Desktop-managed version → bundled sidecar → existing system Pi fallback. Advanced system mode accepts a native-validated executable path or PATH discovery. |
| Process lifecycle | ✅ RPC, terminal, and package-operation children are owned and stopped on window/application exit; runtime maintenance is serialized and refuses active RPC sessions. |
| Electron host/preload | ❌ Deliberately absent. Tauri commands are the native boundary. |

## Chat and Agent Loop

| Pi capability | Desktop status |
| --- | --- |
| Prompt / steer / follow-up | ✅ Real RPC requests from the composer. |
| Delta-only assistant text and thinking | ✅ Normalized and reconciled with authoritative message-end data. |
| Tool lifecycle and output | ✅ Rendered from real tool start/update/end events. |
| Abort and settled state | ✅ Stop uses Pi RPC and waits for the actual settled event. |
| Images | ✅ PNG/JPEG/WebP/GIF picker, paste, and drop payloads use Pi's native image shape. |
| Extension custom UI dialogs/widgets | ⏸️ Not integrated in the React renderer. The inherited native response command is not presented as a completed feature. |

## Sessions

| Pi capability | Desktop status |
| --- | --- |
| List workspace sessions | ✅ Native bounded JSONL index filtered to the selected workspace. |
| New / switch / resume | ✅ Separate session-owned Pi RPC runtimes. |
| Rename / delete | ✅ Real Pi rename plus guarded deletion inside the Pi sessions directory. |
| Fork | ✅ Real fork-point query and fork with composer restoration. |
| Rapid selection | ✅ Latest selection wins; per-session messages and model state remain isolated. |
| Export, stats, tree/history overlays | ⏸️ Not migrated yet. |

## Models and Authentication

| Pi capability | Desktop status |
| --- | --- |
| Available models / set model | ✅ Live per-session RPC catalog and switching. |
| Thinking levels | ✅ Live supported-level query and per-session change. |
| Credential visibility | ✅ Metadata only: provider, source, and credential kind. Secrets are never serialized to the WebView. |
| Remove provider credential | ✅ Explicitly confirmed, provider-scoped native edit with malformed-file preservation. |
| Interactive `/login` | ⚠️ Pi 0.84.2 does not expose it over RPC; Desktop gives guidance and does not add a Node auth host. |

## Workspace Files

| Capability | Desktop status |
| --- | --- |
| Browse and index | ✅ Workspace-relative native commands skip generated directories and symlinks. |
| Preview and edit | ✅ Existing UTF-8 text files up to 1 MiB, with stale-content conflict protection. |
| `@file` composer insertion | ✅ Quoted paths and ranked completion. |
| General filesystem access | ❌ No recursive home-directory permission or direct renderer filesystem plugin. |

## Terminal, Git, and Worktrees

| Capability | Desktop status |
| --- | --- |
| Terminal | ✅ Lazy xterm renderer backed by an owned native PTY. |
| Git status and diff | ✅ Typed native commands with bounded diff output. |
| Worktree list/create/use/remove | ✅ Adjacent destinations and guards for main/current/dirty/locked/prunable worktrees. |
| Arbitrary Git or shell command bridge | ❌ Deliberately absent. |
| Stage/commit/fetch/push/reset | ⏸️ Not part of the current coding-workflow subset. |

## Pi Ecosystem

| Pi capability | Desktop status |
| --- | --- |
| `pi list` | ✅ Typed native command parses Pi's output. User packages are visible by default; project packages require an explicit trust confirmation before Pi is called with `--approve`. |
| `pi install` | ✅ User/project scopes with an explicit full-system-access warning. Local sources must resolve inside the selected workspace. |
| `pi remove` | ✅ Exact source and scope from the listed package, with explicit confirmation. |
| `pi update --extensions` | ✅ Explicitly confirmed update through Pi; project packages are included only after project trust approval, and pinned-package behavior remains Pi-owned. |
| Extensions / plugins | ✅ Current invokable commands come from the active runtime's real `get_commands` response. Pi represents plugin behavior as extensions. |
| Skills | ✅ Real `/skill:name` commands grouped from `get_commands/sourceInfo`. |
| Prompt templates | ✅ Real prompt commands grouped from `get_commands/sourceInfo`. |
| Command use | ✅ Stages `/<name>` in the composer; never executes automatically. |
| Themes | ✅ Pi built-in `dark`/`light` plus direct user/project `themes/*.json`. Package-owned themes remain managed and represented by their package. |
| Package gallery, recommendations, search | ❌ Not copied from Gustav; discovery/recommendation policy is not duplicated in Desktop core. |
| Resource enable/disable (`pi config`) | ⚠️ Remains Pi's interactive TUI mechanism; Desktop does not rewrite its package/filter/trust policy. |

Package operations are serialized, capped at 512 KiB of captured output, limited to 120 seconds, and cleaned up with the application. The WebView cannot supply arbitrary Pi arguments, environment variables, working directories, or executable paths.

## Desktop Shell

| Capability | Desktop status |
| --- | --- |
| React 19 shell | ✅ Warm paper design with light/dark persistence. |
| Native titlebar controls | ✅ Drag, minimize, maximize/restore, and close. |
| Rust runtime proof | ✅ Platform, architecture, and version are displayed from Tauri. |
| Browser Agent / Channels | ❌ Explicitly dropped from this product boundary. |

## Desktop Runtime

| Capability | Desktop status |
| --- | --- |
| Runtime ownership | ✅ Versioned standalone Pi binaries live only under the app-data `pi-runtime/versions` directory. Desktop never changes global npm packages or PATH. |
| Official release discovery | ✅ Manual checks use the fixed `earendil-works/pi` latest-release API and select only the exact OS/architecture asset. No startup polling is added. |
| Verified install/update | ✅ The matching asset and `SHA256SUMS` are size-bounded, the exact SHA-256 is checked, archive paths and entry types are constrained, and the extracted binary must pass a bounded `pi --version`. |
| Rollback | ✅ Previous verified versions remain installed; the active pointer is transactional and any installed version can be reactivated. |
| System Pi mode | ✅ Explicit advanced fallback; Desktop validates and launches it but never updates or removes it. |
| Diagnostics and logs | ✅ App-data/settings/log paths, active process counts, installed versions, and bounded lifecycle-only logs are visible. Prompts, outputs, credentials, and environment variables are excluded. |
| Interrupted install recovery | ✅ Each staging directory has an owner lock. Startup removes only abandoned unlocked `.install-*` directories and leaves active/installed directories untouched. |
| Release packaging | ✅ Windows x64 release build produces both MSI and NSIS bundles from the locked Rust graph. |
| Silent/background update | ❌ Deliberately absent. Download/install and version switches require an explicit in-app confirmation and apply only to new sessions. |

## Remaining release work

- Re-run `npm run check:publish` on the final clean commit before connecting/pushing the independent repository.
- Run the prepared installer lifecycle workflow on a clean hosted Windows runner; no such run has been claimed from the development machine.
- Configure Windows signing and macOS signing/notarization, then pass the signed cross-platform release-smoke workflow.
- Connect an independent repository URL and private vulnerability-reporting route while retaining the derivative-work declaration.
- Run a true cross-version upgrade gate once an earlier Pi GUI release exists; `0.1.0` can only prove the update/reinstall path.
