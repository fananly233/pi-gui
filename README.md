# Pi Desktop

A native-feeling desktop shell for the **Pi Coding Agent** CLI (`pi --mode rpc`).

<p align="left">
  <a href="https://github.com/gustavonline/pi-desktop/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/gustavonline/pi-desktop/ci.yml?branch=main&style=for-the-badge" /></a>
  <a href="https://github.com/gustavonline/pi-desktop/releases"><img alt="Release" src="https://img.shields.io/github/v/release/gustavonline/pi-desktop?include_prereleases&style=for-the-badge" /></a>
  <a href="./LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-6b7280?style=for-the-badge" /></a>
</p>

<p align="left">
  <img src="./assets/branding/pi-desktop-icon.svg" alt="Pi DESK app icon" width="120" />
</p>

Pi Desktop is intentionally **minimal** and **extension-first**:
- the desktop app is the host/shell,
- the `pi` CLI is the runtime,
- packages/extensions provide optional behavior.

## Project lineage

This repository is a derivative of [Gustav Pi Desktop](https://github.com/gustavonline/pi-desktop), using its Tauri 2/Rust/Pi RPC implementation as the native base. Selected React UI ideas and visual tokens are adapted from [DLYZZT Pi Desktop](https://github.com/DLYZZT/pi-desktop) under Apache-2.0. The code here contains additional modifications and is not presented as an official release of either upstream project.

Exact source revisions, licenses, and modification boundaries are recorded in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and [MIGRATION_MATRIX.md](./MIGRATION_MATRIX.md).

## Current migration status

The active React renderer now implements the migration through **Phase 8: Desktop Runtime**. It includes the real Pi chat path, isolated sessions, model/auth workflows, workspace-scoped files and attachments, a managed native PTY with xterm, typed Git/worktree workflows, Pi ecosystem management, and a verified app-data-owned Pi runtime with explicit system fallback and rollback. Clean-machine installer testing, signing/notarization, final branding, and public release setup remain release work.

<img width="1227" height="869" alt="Screenshot 2026-03-28 at 23 28 39" src="https://github.com/user-attachments/assets/0c15a79f-870c-44a0-9489-4b0d2d577e76" />




---

## Why Pi Desktop exists

Pi Desktop gives you a stable desktop UX for Pi without hardcoding product logic into the app.

### Core philosophy

1. **Host boundary first**
   - Desktop app handles windows, panes, files, tabs, notifications, and native UX.
2. **Agent behavior stays in Pi + packages**
   - Workflows/policies should be extension-driven where possible.
3. **Multi-session reliability over gimmicks**
   - Runtime isolation, generation-safe switching, and persistence matter most.
4. **Calm UI**
   - Minimal visuals, neutral colors, low noise, and predictable controls.

### Current development direction

- **Core app focus:** UI polish, interaction quality, and performance (lighter/faster desktop shell).
- **Capability growth:** packages/extensions should drive optional workflows and policies.
- **Hardcoding rule:** avoid embedding project-specific automation/policy logic in app core.
- **Architecture intent:** Pi Desktop is a capability host for extensions, not a monolithic workflow engine.

### Recent highlights (v1.0.0)

- Codex-inspired UI polish across chat timeline, composer, and no-project welcome/dashboard flows.
- Composer slash behavior is deterministic, and `/skill:<name>` now stages a skill pill before send.
- Settings UX is more resilient (including no-project mode) with sidebar-integrated navigation while Settings is open.
- Terminal now runs as a docked bottom panel in chat, with reduced timeline noise.
- Desktop auto-refreshes runtime auth state when `~/.pi/agent/auth.json` changes after login/logout.
- Bundled/default themes now conform to full Pi CLI theme schema, with legacy-theme auto-repair.
- Cross-platform `v1.0.0` artifacts are published for macOS, Windows, and Linux.

---

## Features

### Feature snapshot (short)

- Multi-workspace, project-aware desktop shell for Pi
- Session-first chat workflow with streaming, tools, and thinking timeline
- Docked terminal, right-side file split, and command palette
- Deterministic slash commands + runtime-discovered extension/skill/prompt commands
- Package/resource management (`pi install/remove/update/list`) in-app
- Model/provider picker with auth actions and diagnostics
- Robust settings, updates, and no-project-safe UX

### Built-in features (technical)

- **Workspace/session architecture**
  - Workspace + project sidebar with pin/reorder semantics
  - Session-first tabs (chat-centered), session browser/history/fork flows
  - Session context actions (including **Mark unread**)

- **Chat + composer**
  - Streaming chat UI with compact workflow/tool/thinking timeline
  - Composer slash palette with deterministic slash execution
  - Full input history (`ArrowUp` / `ArrowDown`), queued follow-ups, and message actions

- **Commands + shortcuts**
  - Built-in slash commands for settings/model/import/export/share/tree/fork/resume/compact/reload/quit
  - Command palette + shortcuts panel

- **Model/provider/auth**
  - Model picker with provider grouping + login/logout actions
  - Account diagnostics + auth status visibility
  - Auto-refresh of auth state when `~/.pi/agent/auth.json` changes

- **Terminal + files**
  - Docked xterm terminal panel in chat
  - Right-side file split panel with resize
  - Drag/drop attachments and file reference pills in composer

- **Packages/resources/themes**
  - Package manager pane (`pi install/remove/update/list`)
  - Recommended package + skill catalogs
  - Package settings modal with capability-driven Save/Apply UX
  - Bundled desktop themes + CLI-schema-compatible theme handling

- **Settings + updates + reliability**
  - Simplified Settings IA with no-project-safe behavior
  - **Manual CLI binary path override** in Settings (all OS) for environments where PATH discovery is unreliable
  - First-run CLI onboarding when `pi` is missing
  - In-app desktop + CLI update checks/actions
  - Inline runtime/provider error visibility in chat timeline
  - Native notifications via extension UI boundary (`ctx.ui.notify`)

Detailed capability map: [`FEATURE_MAPPING.md`](./FEATURE_MAPPING.md)

---

## Download

Go to **[Releases](https://github.com/gustavonline/pi-desktop/releases)** and download:
- macOS: `.dmg` + app bundle archive (`.app.tar.gz`)
- Windows: `.exe` (NSIS installer) and/or `.msi`
- Linux: `.AppImage` and `.deb`

Latest stable release: **[`v1.0.0`](https://github.com/gustavonline/pi-desktop/releases/tag/v1.0.0)** (2026-04-13).

If no release is available yet, follow **Build from source** below.

### Unsigned build notes

#### macOS (Gatekeeper)
Until notarized signing is configured, macOS may block downloaded builds with messages like “app is damaged”.

Use one of these options:

1. Terminal workaround:

```bash
xattr -cr /Applications/Pi\ Desktop.app
```

2. System Settings workaround:
   - Open **System Settings → Privacy & Security**
   - Find the blocked Pi Desktop warning
   - Click **Open Anyway** and confirm

#### Windows (SmartScreen)
If SmartScreen appears:
- Click **More info**
- Click **Run anyway**

#### Linux (AppImage)
If needed:

```bash
chmod +x Pi.Desktop_<version>_amd64.AppImage
```

---

## First run

Open **Pi Runtime** from the workspace sidebar. Managed mode is the default:

- If a verified Desktop-managed Pi version exists, new sessions use it.
- Otherwise, an existing system Pi is used as a non-mutating fallback.
- **Install managed Pi** shows an explicit confirmation before downloading the matching `earendil-works/pi` release, verifying its published SHA-256 checksum, and activating it under the app-data directory.
- Advanced system mode can validate a specific executable or use PATH discovery. Pi Desktop never updates or removes that system installation and never changes global npm packages or PATH.

---

## Build from source

### Prerequisites

- Node.js >= 22
- Rust toolchain
- Platform build dependencies for Tauri 2

### Dev

```bash
npm install
npm run tauri dev
```

### Production build

```bash
npm run check
npm run build:frontend
npm run tauri build
```

### Phase 2–8 verification

```bash
npm test
npm run gate:pi-real
npm run gate:sessions-real
npm run gate:models-real
npm run gate:ecosystem-real
npm run gate:runtime-real
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

`gate:pi-real` starts the installed Pi CLI in real RPC mode with `--no-session`. It defaults to `deepseek/deepseek-v4-flash` and can be redirected with `PI_GUI_GATE_PROVIDER`, `PI_GUI_GATE_MODEL`, and `PI_GUI_GATE_CWD`.

`gate:sessions-real` uses an isolated temporary session directory and proves new, rename, history restore, fork, switch/resume, persistence, and resume after a real Pi process restart. A caller-supplied `PI_GUI_GATE_SESSION_DIR` is always preserved; set `PI_GUI_GATE_KEEP_SESSIONS=1` to retain an automatically created test directory.

`gate:models-real` uses `--no-session`, sends no prompt, and verifies the real model catalog, model switching/restoration, supported thinking levels, and a fresh Pi process restart. It uses the same `PI_GUI_GATE_PROVIDER`, `PI_GUI_GATE_MODEL`, and `PI_GUI_GATE_CWD` overrides as the chat gate.

`gate:ecosystem-real` exercises Pi package operations and runtime-discovered commands inside isolated user/project roots without changing the real Pi settings file.

`gate:runtime-real` downloads the current official standalone asset into an isolated temporary runtime root, verifies `SHA256SUMS`, safely extracts it, runs `pi --version`, and proves that a second install reuses the verified version. It does not install into the application's real data directory or modify the system Pi.

Artifacts are generated under:

`src-tauri/target/release/bundle/`

---

## Architecture

See:
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)**
- **[`docs/CAPABILITY_MODEL.md`](./docs/CAPABILITY_MODEL.md)**

Short version:
- **Frontend (React 19/TypeScript)**: UI shell, chat, session workflows, and interactions
- **Tauri backend (Rust)**: native bridge, CLI process management, filesystem/window commands
- **Pi RPC bridge**: typed JSON-RPC-style line protocol over stdin/stdout
- **Packages/extensions**: opt-in behavior and UI integrations through the extension UI protocol

> Migration note: the active renderer is React; the Tauri/Rust host remains based on Gustav Pi Desktop.

---

## Packages and extension model

See: **[`docs/PACKAGES.md`](./docs/PACKAGES.md)**

Pi Desktop treats packages as first-class building blocks:
- install globally or per project,
- surface loaded resources in-app,
- keep policy/automation outside the shell when possible.

---

## Security and permissions

See: **[`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md)**

The WebView has no general filesystem or shell-execution capability. Files, terminal lifecycle, Git status/diffs, and guarded worktree operations are exposed through narrow Rust commands. Review the documented boundaries before deploying in restricted environments.

---

## Releases

See: **[`docs/RELEASES.md`](./docs/RELEASES.md)**

Release-related docs:
- [`docs/RELEASES.md`](./docs/RELEASES.md)
- [`docs/ICONS.md`](./docs/ICONS.md) (icon source + regeneration + validation)

GitHub Actions workflows are set up for:
- CI validation
- tagged cross-platform release builds (macOS + Windows + Linux)

---

## Contributing

- Read [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Open an issue before large changes
- Keep changes aligned with extension-first architecture and minimal UX goals

---

## License

MIT — see [`LICENSE`](./LICENSE)

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=gustavonline/pi-desktop&type=Date)](https://www.star-history.com/#gustavonline/pi-desktop&Date)
