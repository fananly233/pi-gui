# Architecture

This document explains the **product architecture** (not deep code internals).

## Mental model

Pi Desktop is a 3-layer system:

1. **Desktop host (this app)**
2. **Pi CLI runtime (`pi --mode rpc`)**
3. **Packages/extensions**

```text
User
  -> Pi Desktop UI (React + Tauri shell)
    -> RPC bridge (stdin/stdout)
      -> pi --mode rpc runtime
        -> packages/extensions/skills/prompts/themes
```

---

## Layer responsibilities

## 1) Desktop host (Pi Desktop)

Owns:
- windowing, panes, tabs, sidebar
- native integrations (filesystem, window focus, notifications bridge)
- workspace/project/session navigation
- resilient runtime orchestration across sessions
- rendering extension UI primitives (`notify`, `select`, `confirm`, `input`, `editor`, etc.)

Does **not** try to own all agent workflow policy.

## 2) Pi runtime (`pi --mode rpc`)

Owns:
- model execution
- conversation/session state
- tool execution pipeline
- package loading and runtime behavior

Pi Desktop talks to this runtime through the typed frontend adapter in `src/pi/pi-adapter.ts` and the Tauri/Rust process bridge in `src-tauri/src/lib.rs`.

## 3) Packages/extensions

Own optional behavior:
- workflow automation
- notification policy
- project-specific conventions
- extra commands/skills/prompts/themes

This keeps the desktop shell generic and maintainable.

### Practical direction for ongoing development

- Keep app-core work focused on **UI polish + performance + reliability**.
- Add new user-facing workflows through **packages/extensions first** whenever possible.
- Treat Pi Desktop as a **capability host** (`ctx.ui`, native shell bridge), not a hardcoded workflow layer.

For an explicit host contract and capability list, see [`docs/CAPABILITY_MODEL.md`](./CAPABILITY_MODEL.md).

When implementing package/extension-specific desktop affordances, follow [`docs/PACKAGE_CAPABILITY_TEMPLATE.md`](./PACKAGE_CAPABILITY_TEMPLATE.md).

---

## Runtime/session design

Pi Desktop supports multiple sessions with one isolated Pi RPC runtime per opened session.

Key goals:
- avoid cross-session state bleed
- avoid stale event application when switching fast
- keep UI responsive during reconnects/restarts

Each runtime has a stable instance id and a Rust generation. Pi events update only the snapshot owned by that runtime, while a monotonic selection guard prevents a slower session load from replacing a newer selection. Model and thinking settings are stored on that same runtime snapshot, so switching sessions cannot bleed configuration across conversations. Closing or disconnecting drains every runtime process, including Windows `.cmd`/Volta descendant trees.

## Model and authentication boundary

Model listing, selection, and thinking levels use Pi RPC. Full Pi model records are normalized to safe display fields before entering React state; provider headers, endpoint configuration, and credential material are discarded.

Authentication remains owned by Pi:
- Rust exposes provider/source/type metadata, never credential values.
- Environment credentials are read-only in the GUI.
- Removing a credential stored in Pi requires an explicit confirmation and then disconnects all runtimes.
- Interactive login is performed with `/login` in Pi TUI because Pi RPC 0.84.2 has no login command. The desktop does not add an Electron/Node auth host to work around that boundary.

---

## Onboarding + update flow

### First run
Managed mode first resolves a verified version under the Desktop app-data directory, then a packaged sidecar, and finally an existing system Pi as a non-mutating fallback. The Runtime panel can install the matching standalone release after an explicit confirmation, or select an advanced system executable validated by the native layer.

### Update flow
Release checks are manual and lazy: opening the Runtime panel reads only local state, while **Check updates** queries the fixed `earendil-works/pi` latest-release endpoint. Install/update verifies the exact published SHA-256, constrains archive extraction, runs a bounded `pi --version`, and transactionally activates the version. Previous versions remain available for rollback. No global npm package or PATH entry is changed.

Runtime maintenance is serialized and refused while Pi RPC sessions are active. Interrupted staging directories carry owner locks and are removed on startup only when abandoned. Diagnostics expose bounded lifecycle metadata, paths, versions, and process counts; prompts, model output, credentials, and environment variables are not logged.

---

## UI philosophy

- neutral, low-noise visual language
- minimal but clear controls
- hover-revealed secondary actions
- avoid flashy/unreadable high-contrast accents

---

## Security boundary

Tauri permissions are declared in `src-tauri/capabilities/default.json`.

Important: native terminal, workspace, package, and runtime operations are exposed through typed Rust commands. The renderer cannot supply arbitrary runtime executable arguments or environment variables, and it has no generic shell-process bridge. Validate the declared capabilities against your environment policy before deployment.
