# Pi GUI 0.1 RC Stabilization Acceptance

Last updated: 2026-08-23.

## Scope and decision boundary

Phase 9 stabilized the existing `0.1.0` feature set. It did not add a new product surface, create a tag or GitHub Release, weaken release gates, or configure signing credentials. This is a historical acceptance record; the later maintainer decision to publish source only permanently keeps these Windows installers outside the supported distribution boundary regardless of signature state.

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
| `npm run check:publish` | PASS across 150 tracked/non-ignored candidate files, including the final evidence update. |

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

The first RPC rerun exposed a real cold-start condition: Pi installed a configured package before it consumed RPC input, which exceeded the old 35-second gate timeout. The RPC, session, and model gates now use the same five-minute startup-readiness budget as the desktop, while ordinary post-start RPC requests retain their 35-second timeout. A second cold run completed and all five gates passed.

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
- Concurrent Pi startup, Git worktree, and package mutations are locked before any awaited listener or native confirmation, preventing duplicate starts or reentry while a dialog is open.
- Models/auth refreshes when the same runtime transitions from loading to ready.
- Rust app data can be redirected for native tests through an absolute, non-root `PI_GUI_DATA_DIR` that rejects parent-directory components.

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

## Hosted clean-machine evidence

The tested runtime/source commit is `867ac378a0eaab9c55c38daecea81b1491b357d2`. [CI run 32658150459](https://github.com/fananly233/pi-gui/actions/runs/32658150459) and [Windows clean-machine run 32658152422](https://github.com/fananly233/pi-gui/actions/runs/32658152422) both passed for that exact commit.

The clean-machine job passed dependency install, candidate validation, Windows bundle build, MSI administrative extraction, NSIS install, first launch, same-version update/reinstall, uninstall, shortcut and registry cleanup, and app-data preservation. Cross-version upgrade was skipped because no earlier Pi GUI release exists. Historical artifact `9498181296`, `pi-gui-windows-unsigned-candidate`, was a 9,954,766-byte ZIP with digest `sha256:74f3c4ca878b6302f74f633c04d25dea4114291ba5a76347b5f25b7fb782104d`; Phase 10C permanently deleted the ZIP while retaining the run and logs.

This is unsigned lifecycle evidence, not permission to publish the installers. No tag or GitHub Release was created.

## Phase 10C source-only revalidation

[PR #2](https://github.com/fananly233/pi-gui/pull/2) moved the project to the source-only policy. The active merge commit is `26ca58662b33d0f8c85d5ca54a400b79557e2765`; it has the reviewed base and head as its two parents, its tree matches the reviewed PR head, and its active author/committer metadata uses the approved public GitHub noreply identity. GitHub's immutable PR record may retain a superseded platform-generated merge-object reference with non-approved author-email metadata; that object is not active `main`.

[Mainline CI #19](https://github.com/fananly233/pi-gui/actions/runs/32672786127) passed on that exact merge with no artifacts. [Windows clean-machine run #7](https://github.com/fananly233/pi-gui/actions/runs/32672896200) then passed candidate validation, ephemeral NSIS/MSI build, MSI administrative extraction, and the NSIS clean-machine lifecycle. Its log reports `CLEAN_MACHINE_INSTALL_SMOKE=PASS` and `VERSION=0.1.0`; the run retained no installer artifact.

The maintainer explicitly approved permanent deletion of the three historical unsigned installer artifacts. GitHub returned `204 No Content` for each deletion, and a fresh API query reports an empty artifact list for every source run:

| Artifact ID | Source run | Historical SHA-256 | Result |
| --- | --- | --- | --- |
| `9496313691` | [`32650837760`](https://github.com/fananly233/pi-gui/actions/runs/32650837760) | `f20806ca1be04b3bb70952339ccf58dbe2b5b9602311f690ddb978dbf6eb3bd8` | Deleted; run/log retained. |
| `9498181296` | [`32658152422`](https://github.com/fananly233/pi-gui/actions/runs/32658152422) | `74f3c4ca878b6302f74f633c04d25dea4114291ba5a76347b5f25b7fb782104d` | Deleted; run/log retained. |
| `9499997749` | [`32665181610`](https://github.com/fananly233/pi-gui/actions/runs/32665181610) | `3fa655fa6f51ae00b24f23c2b46648f64c337e46415eabef8babd64bfda29d31` | Deleted; run/log retained. |

No signing credential, tag, draft, or GitHub Release was created or accessed during this revalidation.

## Remaining source release gates

- Keep deterministic/privacy checks passing on the exact intended source commit.
- Create a zero-asset draft from the exact tag and verify that only GitHub-generated source archives are present.
- Keep Windows lifecycle runs as optional engineering evidence; do not upload their temporary installers.
- Do not create or publish a tag/Release until the maintainer explicitly starts that separate release step.
