# Pi GUI

Pi GUI is a Tauri 2 + React 19 desktop client for the [Pi coding agent](https://github.com/earendil-works/pi). Pi remains the agent runtime; this project provides the native desktop shell, typed RPC bridge, workspace tools, and an optional app-owned Pi runtime.

[![MIT license](https://img.shields.io/badge/license-MIT-6b7280?style=for-the-badge)](./LICENSE)

> Release status: `0.1.0` is an unpublished candidate. Local Windows bundles are currently unsigned, and no independent public release repository has been configured. Do not treat inherited Gustav releases as Pi GUI releases.

## Project lineage

Pi GUI is a derivative of [Gustav Pi Desktop](https://github.com/gustavonline/pi-desktop). Its Tauri 2, Rust, and Pi RPC implementation form the native base. Selected React concepts and visual tokens were adapted from [DLYZZT Pi Desktop](https://github.com/DLYZZT/pi-desktop) under Apache-2.0.

This project contains substantial modifications and is not an official release of either upstream. Exact revisions, licenses, and modification boundaries are recorded in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and [MIGRATION_MATRIX.md](./MIGRATION_MATRIX.md).

## Implemented scope

The React renderer and Tauri host currently cover migration Phases 1–8:

- real Pi RPC chat streaming, tools, abort, and follow-up handling;
- isolated sessions, history restore, rename, fork, switch, and deletion;
- model selection, thinking levels, and secret-safe authentication metadata;
- workspace-contained file browsing, editing, mentions, and image attachments;
- a managed native PTY, bounded Git status/diff, and guarded worktree operations;
- Pi package operations plus live extension, skill, prompt, and theme discovery;
- a versioned app-data-owned Pi runtime with SHA-256 verification, rollback, diagnostics, and an explicit system-Pi fallback.

Electron main/preload/agent-host code, Browser Agent, Channels, unrestricted shell execution, and general renderer filesystem access are deliberately absent. See [FEATURE_MAPPING.md](./FEATURE_MAPPING.md) for the precise capability boundary.

## Runtime safety model

Managed runtime installation is explicit. Pi GUI downloads only the matching standalone asset from `earendil-works/pi`, verifies its published SHA-256 value, validates the extracted executable, and activates it under the application data directory. It does not modify global npm packages, `PATH`, or a system Pi installation.

The WebView cannot choose arbitrary executables, environments, shell commands, or filesystem roots. Native operations are exposed through narrow typed Rust commands; details are in [docs/PERMISSIONS.md](./docs/PERMISSIONS.md).

## Build from source

Prerequisites:

- Node.js 22 or newer;
- a current Rust toolchain;
- the platform dependencies required by Tauri 2.

Install and run:

```bash
npm ci
npm run tauri dev
```

Build:

```bash
npm run check:release
npm run check
npm test
npm run build:frontend
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm audit
npm run build
```

Windows artifacts are written below `src-tauri/target/release/bundle/`.

## Real integration gates

These gates use real Pi behavior and must not be reported as deterministic unit tests:

```bash
npm run gate:pi-real
npm run gate:sessions-real
npm run gate:models-real
npm run gate:ecosystem-real
npm run gate:runtime-real
```

`gate:runtime-real` installs into an isolated temporary root and does not touch the application’s real managed-runtime directory or the system Pi installation.

## Release policy

- Package identity: `Pi GUI`, `com.pi.gui`, version `0.1.0`.
- Windows NSIS is the primary per-user installer; MSI remains an administrator-oriented bundle.
- Downgrades are disabled.
- The Windows WebView2 download bootstrapper is used when WebView2 is missing, so installation may require network access on older or stripped-down systems.
- `.github/workflows/release.yml` creates a draft release only.
- `.github/workflows/windows-clean-machine.yml` builds an unsigned candidate on a fresh GitHub-hosted Windows runner and exercises install, launch, update/reinstall, uninstall, and app-data preservation.
- `.github/workflows/release-smoke.yml` is the signed-artifact gate and refuses Windows assets without a valid Authenticode signature.

No release should be made public until signing/notarization and clean-machine evidence are complete. See [docs/RELEASES.md](./docs/RELEASES.md).

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Capability model](./docs/CAPABILITY_MODEL.md)
- [Packages](./docs/PACKAGES.md)
- [Permissions](./docs/PERMISSIONS.md)
- [Release process](./docs/RELEASES.md)
- [Icon maintenance](./docs/ICONS.md)

## License

The repository is licensed under MIT; incorporated material remains subject to the notices and licenses listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
