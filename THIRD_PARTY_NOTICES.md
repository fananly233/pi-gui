# Third-Party Notices

This repository is a derivative work. The repository-level license remains MIT as described in `LICENSE`; incorporated third-party material remains subject to its original license and attribution below.

## Gustav Pi Desktop

- Source: <https://github.com/gustavonline/pi-desktop>
- Base revision: `5d698433864fbebafa24e141da0ea56297766cfe`
- License: MIT (`LICENSE`)
- Use in this repository: Tauri 2 application structure, Rust commands, Pi RPC lifecycle, native capabilities, terminal/Git foundations, assets, and the initial frontend baseline.
- Modifications: the renderer was migrated from Lit to React while preserving the Rust/Tauri runtime boundary. Later phases add typed chat/session/model/file/ecosystem bridges, replace broad renderer shell/Git entry points with a managed native PTY and typed Git/worktree commands, and add a versioned Desktop-owned Pi runtime manager.

## DLYZZT Pi Desktop

- Source: <https://github.com/DLYZZT/pi-desktop>
- Upstream reference revision: `463b483e03c97696b45f7e5a418213ff95d358d6`
- Local donor snapshot: `b214b7426415551ba764fcf23159c26ddbca30ef`
- License: Apache License 2.0; see `LICENSES/DLYZZT-Apache-2.0.txt`.
- Use in this repository: selected React shell, chat, file-tree, file-viewer, `@file` completion, and worktree presentation concepts; warm paper design tokens, theme initialization behavior, and visual layout language.
- Modifications: donor material is reduced and adapted to Tauri. Chat, file, terminal, and Git components are minimal rewrites rather than wholesale copies, while the Pi protocol adapter and workspace-scoped native bridges target Gustav's Tauri/Rust boundary; Electron main/preload/agent-host, Browser Agent, Channels, and Settings implementations are not incorporated.

## Karpathy Guidelines skill

- Source: <https://github.com/nguyenphutrong/andrej-karpathy-skills-codex/tree/25d7dd3f6764dc2023d647cb60a8addd217c16c9/.agents/skills/karpathy-guidelines>
- Revision: `25d7dd3f6764dc2023d647cb60a8addd217c16c9`
- License: MIT, as declared by the upstream README at this revision.
- Files: `.agents/skills/karpathy-guidelines/`
- Modifications: copied without content changes for repository-scoped development guidance.

## Phase 6 terminal libraries

- xterm.js: <https://github.com/xtermjs/xterm.js>, packages `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0, MIT.
- portable-pty: <https://github.com/wezterm/wezterm>, crate `portable-pty` 0.9.0, MIT.
- Use in this repository: terminal emulation, fit-to-panel behavior, and native cross-platform PTY ownership. Pi Desktop's React/Rust lifecycle and security boundary are project modifications, not upstream xterm.js or portable-pty features.

## Pi standalone runtime

- Source and release assets: <https://github.com/earendil-works/pi>
- Use in this repository: Phase 8 can download the exact platform/architecture standalone release on explicit user request, verify the accompanying published SHA-256 checksum, and store versioned binaries under the application's data directory.
- Distribution boundary: no Pi standalone binary is committed to or bundled by this repository. Downloaded runtime artifacts remain separate upstream software; Pi Desktop's downloader, extraction guards, activation pointers, rollback, diagnostics, and lifecycle integration are project modifications.
