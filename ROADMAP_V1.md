# Pi GUI Roadmap

Last updated: 2026-08-23.

## Product direction

Pi GUI is a native, low-noise desktop host for the Pi coding agent. Pi remains the source of truth for execution, sessions, models, authentication, packages, and extension behavior. Pi GUI adds desktop UX and narrow native capabilities without forking Pi internals or recreating an Electron agent host.

## Current milestone: 0.1.0 source release

Phases 1–8 are implemented:

- React/Tauri shell and native window bridge;
- real Pi RPC chat and isolated multi-session lifecycle;
- models, thinking levels, and secret-safe authentication metadata;
- workspace-contained files and image attachments;
- native PTY plus bounded Git/worktree tools;
- Pi package operations and runtime resource discovery;
- verified, versioned, app-owned Pi runtime with rollback and system-Pi fallback.

Phase 9 stabilization and Phase 10A mainline integration established deterministic, real-Pi, native, and clean-machine engineering evidence. The maintainer has chosen a source-only distribution model: Pi GUI will not publish official executables or installers, and code signing is no longer part of the `0.1.0` plan.

Remaining `0.1.0` work:

1. merge the source-only policy and automation changes after CI passes;
2. run the final source/privacy gates on the exact `main` commit;
3. with explicit approval, create `pi-gui-v0.1.0`, inspect the zero-asset draft, and publish only the GitHub-generated source archives.

## After 0.1

Potential follow-up work, ordered by user value and safety:

- session export, statistics, and tree/history views;
- a reviewed Git stage/commit workflow while keeping push/reset outside an unrestricted renderer bridge;
- extension custom UI support based on real Pi RPC contracts;
- native authentication UX only if Pi exposes a stable non-TUI interface;
- accessibility, keyboard navigation, performance, and visual polish;
- cross-platform source-build documentation and reproducibility checks.

Package gallery/recommendation policy, Browser Agent, Channels, a general shell API, a second agent runtime, public binary distribution, and automatic installer updates remain out of scope unless their product and trust boundaries are deliberately revisited.

## Definition of a stable 1.0

- repeated real-Pi chat/session/model/file/terminal/package flows are reliable on documented source-build platforms;
- permissions remain narrow, documented, and testable;
- version tags, source archives, changelog, attribution, and security reporting are operational;
- a fresh checkout can reproduce the documented development and local packaging checks;
- documentation matches the shipped React/Tauri source;
- no open release-blocking security or data-loss issue remains.
