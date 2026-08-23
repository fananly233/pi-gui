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

The independent repository, public metadata, attribution, derivative commit-identity cleanup, Phase 9 RC stabilization, Phase 10A mainline integration, and final unsigned Windows install lifecycle are complete. The remaining `0.1.0` work is privacy closure and release engineering, not feature expansion:

1. delete the known local sensitive fixture copies and record the decision for the historical GitHub PR metadata residual;
2. select an eligible exportable-PFX or provider-specific Windows signing route, then configure trusted Authenticode signing for NSIS and MSI;
3. build a signed draft from the exact intended tag and pass Signed Windows Release Smoke;
4. publish the first Pi GUI release only after those gates pass.

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
