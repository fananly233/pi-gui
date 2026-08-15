# Capability Model

Pi Desktop is a **capability host** for the Pi ecosystem.

## Mental model

- **Desktop app**: host capabilities (native shell/window UX, extension UI bridge, runtime bridge)
- **Extensions/packages**: implement optional workflows on top of host capabilities
- **Pi runtime (`pi --mode rpc`)**: executes commands, loads extensions/resources, and emits capability events

This keeps app-core lightweight while enabling ecosystem-driven behavior.

## Workspace file capability contract

The renderer never receives a general-purpose filesystem API. Phase 5 project access is provided by four Rust commands:

- `list_workspace_directory`
- `index_workspace_files`
- `read_workspace_file`
- `write_workspace_file`

Each command is scoped to a canonical workspace root and relative path. The file index exists only for `@file` completion; image attachments use Pi RPC's native `images` payload and are not written to disk by the desktop app.

## Terminal capability contract

Phase 6 provides one renderer-owned xterm surface backed by a real native PTY. The renderer can start, write, resize, and stop only the terminal ID returned by Rust. Shell discovery, process ownership, byte-stream events, and process-tree cleanup remain native responsibilities. No arbitrary WebView shell capability is granted.

## Git/worktree capability contract

Git is intentionally not an IDE command console. Typed Rust commands provide status, staged/unstaged diff, worktree list, guarded create, and safe remove. There is no renderer API for arbitrary arguments, stage, commit, fetch, push, reset, force removal, or choosing an unrestricted destination. Switching to a listed worktree disconnects the active Pi session before changing the selected workspace.

---

## Extension UI capability contract

Current supported `extension_ui_request.method` values:

- `select`
- `confirm`
- `input`
- `editor`
- `notify`
- `setStatus`
- `setWidget`
- `setTitle`
- `set_editor_text`

Source of truth in code:
- `src/components/extension-ui-handler.ts`
  - `SUPPORTED_EXTENSION_UI_METHODS`
  - `normalizeExtensionUiRequest(...)`

---

## Command interoperability contract

Desktop command UX is runtime-driven, not hardcoded per package:

1. Runtime command discovery (`get_commands`) provides command metadata.
2. Desktop slash palette combines:
   - built-ins,
   - runtime extension/prompt/skill commands.
3. Extension config-intent routing is dynamic and recognizes:
   - command names ending with `config`,
   - commands invoked with `config ...` args (example: `/auto-rename config`).

Package/extension command behavior should follow the template in:
- [`docs/PACKAGE_CAPABILITY_TEMPLATE.md`](./PACKAGE_CAPABILITY_TEMPLATE.md)

---

## Settings/default behavior contract (for package compatibility)

For Desktop-safe package behavior:

- package config must define explicit safe defaults,
- lifecycle handlers must no-op when disabled,
- missing config files must not crash runtime hooks,
- read/status commands must work before manual setup.

Desktop should only store transient UI state; durable settings remain package-owned.

---

## SDK compatibility contract

Extensions must use current Pi SDK/runtime APIs.

Important example:
- Prefer `ctx.modelRegistry.getApiKeyAndHeaders(model)`
- Do **not** rely solely on legacy `ctx.modelRegistry.getApiKey(model)`

When supporting mixed runtime versions, use a compatibility helper that tries `getApiKeyAndHeaders` first and falls back to legacy methods.

---

## Unsupported capability behavior

If an extension emits an unsupported `extension_ui_request` method, Pi Desktop:

1. logs a trace/debug entry,
2. sends an explicit error response (`extension_ui_response`) instead of failing silently.

This avoids hidden hangs and makes compatibility gaps easier to diagnose.

---

## Development guardrails

When adding features:

- Prefer capability-driven solutions over package-specific desktop logic.
- Keep app-core focused on:
  - UI polish
  - performance
  - reliability
  - native host quality
- Avoid embedding extension-specific business logic directly in app core.
- For package settings UX in Desktop, follow [`docs/PACKAGE_CAPABILITY_TEMPLATE.md`](./PACKAGE_CAPABILITY_TEMPLATE.md).
