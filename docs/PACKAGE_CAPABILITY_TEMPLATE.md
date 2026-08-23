# Pi Package Compatibility Guide

Use this guide when testing a Pi package against the current Pi GUI React/Tauri host.

## Current integration contract

Pi GUI delegates package installation and behavior to Pi. A package is visible in the desktop through two independent surfaces:

1. package metadata returned by Pi list/install/remove/update commands;
2. invokable extension, skill, or prompt commands returned by the active RPC runtime's `get_commands`.

Pi GUI does not currently host extension custom UI requests or package-specific settings forms. Do not require a desktop-only modal for basic package operation.

## Command compatibility

A desktop-usable command should:

- be exposed by Pi through `get_commands` with valid `sourceInfo`;
- have a stable name and concise description;
- tolerate being inserted as `/<name> ` and executed only after the user confirms the composer;
- return useful text/tool output through the normal Pi session;
- keep TUI-only interactive assumptions optional or provide a clear fallback.

Pi GUI does not hardcode package names, invent command metadata, or automatically execute a discovered command.

## Configuration

Durable configuration remains package/Pi-owned. Until a stable RPC configuration contract exists, configuration that requires interactive `pi config` belongs in Pi TUI.

Packages should use safe defaults, handle missing configuration without crashing, validate writes, and document user/project precedence. Pi GUI will not directly edit arbitrary package JSON files.

## SDK compatibility

Use the APIs supported by the Pi version declared by the package. For model authentication, prefer current `ModelRegistry` APIs such as `getApiKeyAndHeaders` and fail with a user-readable message when authentication is unavailable.

Do not assume Pi GUI installs compatibility shims for deprecated package APIs.

## Security expectations

- Treat package code as full-system-access code.
- Make destructive or networked behavior explicit.
- Avoid reading outside the documented package/workspace scope unless essential and disclosed.
- Never print credentials, provider headers, environment variables, or private file contents.
- Keep user and project installation behavior deterministic and idempotent.

## Verification checklist

- [ ] Package lists correctly in user scope.
- [ ] Project package remains hidden until trust is approved.
- [ ] Install/remove/update uses Pi and respects the selected scope.
- [ ] Local source stays inside the selected workspace.
- [ ] Extension/skill/prompt command appears from live `get_commands`.
- [ ] **Use** stages the command without executing it.
- [ ] Missing config/auth produces an actionable error rather than a crash.
- [ ] No unsupported custom UI or desktop settings behavior is claimed.
- [ ] `npm run check`, `npm test`, and `npm run build:frontend` pass for host changes.
- [ ] `npm run gate:ecosystem-real` passes when real-Pi verification is required.
