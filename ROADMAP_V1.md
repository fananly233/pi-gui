# Pi GUI Roadmap

Last updated: 2026-08-23.

## Product direction

Pi GUI is a native, low-noise desktop host for the Pi coding agent. Pi remains the source of truth for agent execution, sessions, models, authentication, packages, and extension behavior. Pi GUI should add desktop UX and narrow native capabilities without forking Pi internals or recreating an Electron agent host.

## Current milestone: 0.1.0

Phases 1–8 are implemented:

- React/Tauri shell and native window bridge;
- real Pi RPC chat and isolated multi-session lifecycle;
- models, thinking levels, and secret-safe authentication metadata;
- workspace-contained files and image attachments;
- native PTY plus bounded Git/worktree tools;
- Pi package operations and runtime resource discovery;
- verified, versioned, app-owned Pi runtime with rollback and system-Pi fallback.

The remaining `0.1.0` work is release engineering, not feature expansion:

1. finish public documentation and repository privacy cleanup;
2. rewrite post-fork commit identity only after explicit maintainer approval;
3. connect an independent repository and private vulnerability-reporting route;
4. run the prepared Windows clean-machine lifecycle workflow;
5. configure Windows signing and macOS signing/notarization;
6. pass signed release smoke and publish the first Pi GUI release.

## After 0.1

Potential follow-up work, ordered by user value and safety:

- session export, statistics, and tree/history views;
- a reviewed Git stage/commit workflow, while keeping push/reset outside an unrestricted renderer bridge;
- extension custom UI support based on real Pi RPC contracts;
- native authentication UX only if Pi exposes a stable non-TUI interface;
- installer auto-update only after signing and rollback behavior are proven;
- accessibility, keyboard navigation, performance, and visual polish;
- cross-platform clean-machine coverage and a true cross-version upgrade gate.

Package gallery/recommendation policy, Browser Agent, Channels, a general shell API, and a second agent runtime remain out of scope unless the product boundary is deliberately revisited.

## Definition of a stable 1.0

- repeated real-Pi chat/session/model/file/terminal/package flows are reliable on supported operating systems;
- permissions remain narrow, documented, and testable;
- installers are signed, upgradeable, uninstallable, and verified on clean machines;
- release and security-reporting processes are operational;
- documentation matches the shipped React/Tauri implementation;
- no open release-blocking security or data-loss issue remains.
