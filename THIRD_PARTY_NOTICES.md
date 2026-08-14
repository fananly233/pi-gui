# Third-Party Notices

This repository is a derivative work. The repository-level license remains MIT as described in `LICENSE`; incorporated third-party material remains subject to its original license and attribution below.

## Gustav Pi Desktop

- Source: <https://github.com/gustavonline/pi-desktop>
- Base revision: `5d698433864fbebafa24e141da0ea56297766cfe`
- License: MIT (`LICENSE`)
- Use in this repository: Tauri 2 application structure, Rust commands, Pi RPC lifecycle, native capabilities, assets, and the initial frontend baseline.
- Modifications: the renderer is being migrated from Lit to React while preserving the Rust/Tauri runtime boundary.

## DLYZZT Pi Desktop

- Source: <https://github.com/DLYZZT/pi-desktop>
- Upstream reference revision: `463b483e03c97696b45f7e5a418213ff95d358d6`
- Local donor snapshot: `b214b7426415551ba764fcf23159c26ddbca30ef`
- License: Apache License 2.0; see `LICENSES/DLYZZT-Apache-2.0.txt`.
- Use in this repository: selected React shell and chat presentation concepts, warm paper design tokens, theme initialization behavior, and visual layout language.
- Modifications: donor material is reduced and adapted to Tauri. The Phase 2 chat components are minimal rewrites rather than wholesale copies, while the Pi protocol adapter targets Gustav's native Tauri commands; Electron main/preload/agent-host, Browser Agent, Channels, and Settings implementations are not incorporated.

## Karpathy Guidelines skill

- Source: <https://github.com/nguyenphutrong/andrej-karpathy-skills-codex/tree/25d7dd3f6764dc2023d647cb60a8addd217c16c9/.agents/skills/karpathy-guidelines>
- Revision: `25d7dd3f6764dc2023d647cb60a8addd217c16c9`
- License: MIT, as declared by the upstream README at this revision.
- Files: `.agents/skills/karpathy-guidelines/`
- Modifications: copied without content changes for repository-scoped development guidance.
