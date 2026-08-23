# Pi GUI 0.1 RC Stabilization Acceptance

Last updated: 2026-08-23.

## Scope and decision boundary

Phase 9 stabilizes the existing `0.1.0` feature set. It does not add a new product surface, create a tag or GitHub Release, weaken release gates, or configure signing credentials. The candidate remains unpublished and its Windows installers remain blocked from public distribution while `NotSigned`.

This record distinguishes four evidence levels:

1. deterministic source checks;
2. real Pi/runtime gates in disposable state;
3. native Tauri acceptance on the development machine;
4. hosted clean-machine installer lifecycle evidence.

Passing one level does not imply that the later levels passed.

## Deterministic checks

The Phase 9 code tip passed on Windows x86_64:

| Check | Result |
| --- | --- |
| `npm ci` | PASS; locked dependency graph installed with zero reported vulnerabilities. |
| `RELEASE_TAG=v0.1.0 npm run check:release` | PASS. |
| `npm run check` | PASS. |
| `npm test` | PASS; 26 tests. |
| `npm run build:frontend` | PASS. |
| `cargo fmt --check` | PASS. |
| `cargo check --locked` | PASS. |
| `cargo test --locked --lib` | PASS; 25 passed and the explicit network/download runtime test remained ignored. |
| `npm audit` | PASS; zero findings. |
| `npm run check:publish` | PASS across 150 tracked/non-ignored candidate files; rerun is required after the final documentation commit. |

The only retained Rust build warning is the localized MSVC linker message emitted while creating the import library; it is not a test failure.

## Real Pi and runtime gates

All five gates passed with Pi `0.84.2`:

| Gate | Result | Isolation |
| --- | --- | --- |
| `gate:pi-real` | PASS | Temporary agent directory; only auth/settings/models inputs copied; extensions, skills, prompts, themes, context, and project approval disabled. |
| `gate:sessions-real` | PASS | Temporary agent and session directories. |
| `gate:models-real` | PASS | Temporary agent directory and non-persisting model/thinking probes. |
| `gate:ecosystem-real` | PASS | Temporary agent/workspace package fixture; real settings hash preserved. |
| `gate:runtime-real` | PASS | Temporary managed-runtime root; system Pi and normal app data untouched. |

The real Pi auth and settings file hashes were captured before the gates and matched afterwards. No credential values or hashes are stored in this document.

## Native Tauri acceptance

A real `npm run tauri dev` build was exercised through the native Windows application, not a browser mock.

| Area | Accepted behavior |
| --- | --- |
| Shell/runtime bridge | React shell rendered; Rust platform/runtime information loaded; titlebar drag, minimize, maximize/restore, close, and persisted theme worked. |
| Chat | Real text/thinking deltas, one real tool invocation, abort, settled state, and a second prompt passed. |
| Sessions | Persist/restore, rename, fork, switch, and session-owned runtime state passed. Destructive session deletion was not executed during automation. |
| Models/auth | The ready session loaded 362 available models, the current DeepSeek model, thinking levels, and metadata-only auth UI. |
| Files/images | Nested browsing, UTF-8 edit/save, `@file`, image attach/remove, stale-write conflict protection, and binary refusal passed. |
| Terminal | Real PowerShell PTY start, PID-changing restart, close, and child termination passed; no shell command was typed through GUI automation. |
| Git/worktrees | Status/diff and worktree create/list passed. Cancelling both **Use worktree** and **Remove** in the native dialog preserved the current workspace, active session, Git registration, and directory on disk. |
| Ecosystem | Installed package inventory and active extension/skill resources loaded from the real Pi runtime. |
| Desktop runtime | System-Pi fallback, active-process maintenance guard, metadata-only diagnostics, and the managed-runtime real gate passed. |
| Shutdown | Tauri, Pi RPC, PTY, package, Vite, and WebView child processes exited; no test-root process remained. |

## Stabilization fixes proved by the run

- All affected file, worktree, package, trust, and workspace-switch flows now await Tauri's native confirmation plugin. Dialog failure cancels the action.
- Pi startup does not report ready until a correlated `get_state` response arrives. Startup failure stops the spawned RPC instance and rejects pending requests.
- Models/auth refreshes when the same runtime transitions from loading to ready.
- Rust app data can be redirected for native tests through an absolute, non-root `PI_GUI_DATA_DIR`.

For a disposable native run, use unique paths and keep them outside the repository:

```powershell
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pi-gui-rc-" + [guid]::NewGuid())
$env:PI_CODING_AGENT_DIR = Join-Path $testRoot "pi-agent"
$env:PI_GUI_DATA_DIR = Join-Path $testRoot "app-data"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $testRoot "webview2"
npm run tauri dev
```

Populate the disposable `PI_CODING_AGENT_DIR` with only the Pi configuration required for the acceptance run; never point this test at the live Pi agent directory. `PI_GUI_DATA_DIR` is a test-only host override and rejects filesystem roots or parent-directory components. `WEBVIEW2_USER_DATA_FOLDER` is the corresponding Windows WebView2 isolation control. None is exposed to the renderer or recommended as ordinary user configuration.

During the final isolated rerun, runtime diagnostics pointed only to the disposable app-data root. The pre-existing normal runtime log and real Pi auth/settings files retained identical size, timestamp, and SHA-256 values. The isolated lifecycle log contained only `desktop_started`, `rpc_started`, `rpc_exited`, and `desktop_stopped` events.

## Remaining release gates

- Push only the reviewed stabilization branch, then pass CI and rerun the hosted Windows clean-machine lifecycle for the final candidate.
- Configure trusted Windows and Apple signing identities outside Git.
- Produce signed draft assets from the exact intended tag and pass cross-platform signed release smoke.
- Keep cross-version Windows upgrade marked N/A only for `0.1.0`; it becomes mandatory once an earlier Pi GUI release exists.
- Do not create or publish a tag/Release until the maintainer explicitly starts that separate release step.
