# Pi GUI Tauri Migration Matrix

This matrix records the approved migration boundary: Gustav Pi Desktop is the Tauri/Rust/Pi RPC base, while the DLYZZT project is a selective React UI donor. It is intentionally narrower than either upstream application.

## Strategy values

Only these values are valid in the `Strategy` column: `KEEP_GUSTAV`, `PORT_DLYZZT`, `ADAPT`, `REWRITE_MINIMAL`, `DROP`, `DEFER`.

## Phase 0 baseline (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm ci` | PASS | 327 packages installed from the Gustav lockfile. npm reported one deprecated package and three install scripts requiring allow-list review. |
| `npm run check` | PASS | TypeScript completed without diagnostics. |
| `npm run build:frontend` | PASS WITH WARNINGS | Vite 7.3.1 built 1,765 modules. Existing warnings cover mixed static/dynamic imports and a 1.44 MB JavaScript chunk. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH WARNING | Existing Windows-only warning: unused `app` setup parameter at `src-tauri/src/lib.rs:2418`. |
| `npm audit --omit=dev` | RECORDED | Existing lockfile: 21 vulnerabilities (1 low, 4 moderate, 15 high, 1 critical), primarily in the legacy `pi-cursor-agent` dependency chain and the locked Vite generation. No baseline dependency fix was attempted. |
| `npm run tauri dev` | PASS WITH EXISTING WARNINGS | Vite became ready, Rust completed, and `target/debug/pi-desktop.exe` opened a real Tauri window. The Gustav workspace/sidebar shell rendered and closed normally. Tauri also reported pre-existing JS/Rust minor-version mismatches for core API, dialog, and fs packages. |
| MCO Gustav Scout | PASS | `pi:deepseek/deepseek-v4-flash`, read-only, scoped to Tauri/Rust/RPC/sessions/files/terminal/auth/packages. |
| MCO DLYZZT Scout | PASS | `pi:deepseek/deepseek-v4-flash`, read-only, scoped to React foundations/contracts and explicitly excluding Electron host, Browser, Channels, Chat, and Settings. |

## Phase 1 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm run check` | PASS | React 19 shell and thin desktop API compile under strict TypeScript. |
| `npm run build:frontend` | PASS | 39 modules; 214.21 kB JavaScript and 8.40 kB CSS before gzip. No large-chunk warning. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH EXISTING WARNING | Rust tree is unchanged; the baseline unused `app` warning remains. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities after removing the unused legacy renderer dependency chain. A full dev audit still reports six inherited Vite toolchain advisories (`esbuild`, `nanoid`, `picomatch`, `postcss`, `rollup`, `vite`). |
| Static architecture scan | PASS | No Electron dependency, `window.piBridge`, Electron `src/main/`, `src/preload/`, `src/agent-host/`, Browser Agent, or Channels implementation. |
| Windows `npm run tauri dev` | PASS | React shell opened without an Agent Host wait page; Rust returned `windows`, `x86_64`, and `v1.0.0`. |
| Theme behavior | PASS | Light/dark toggle changed the rendered palette and remained selected after reload. |
| Window behavior | PASS | Custom minimize, maximize/restore, close, and explicit Tauri titlebar dragging were exercised in the real window. |

## Phase 2 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | Four deterministic EventNormalizer tests cover delta-only assembly, authoritative `message_end` reconciliation, abort status, accumulated tool output, and `agent_settled`. |
| `npm run check` | PASS | PiAdapter, chat state, Markdown rendering, composer queue modes, and all React components pass strict TypeScript. |
| `npm run build:frontend` | PASS | 300 modules; 390.69 kB JavaScript and 14.64 kB CSS before gzip. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH EXISTING WARNING | The Rust tree remains unchanged; the baseline unused `app` warning remains. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities. The full dev audit still reports the six inherited Vite toolchain advisories recorded in Phase 1. |
| `npm run gate:pi-real` | PASS | Real Pi 0.84.2 with `deepseek/deepseek-v4-flash`; strict LF JSONL, correlated responses, delta-only text/thinking streams, real bash tool, second prompt, steer/follow-up queues, in-flight abort, and settled state all passed without mocks. |
| Windows `npm run tauri dev` | PASS | Gustav Rust discovered the system Volta `pi.cmd`; React connected through Tauri, rendered real streaming output, a real bash tool card, a completed second prompt, and an interrupted long-running tool before returning to Ready. |
| Provider failure recovery | PASS | The configured default `openai-codex` model returned its real usage-limit error; the UI surfaced it and returned to Ready. Successful GUI checks used a temporary local DeepSeek launch wrapper that was removed after validation. |
| Process and architecture cleanup | PASS | No test Pi RPC process or launch wrapper remained; no Electron host, `window.piBridge`, Browser Agent, or Channels code was introduced. |

## Phase 3 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | Nine deterministic tests cover rapid latest-selection wins, per-runtime message isolation, Windows path normalization, persisted history hydration, transition-state file-mutation guards, and the Phase 2 event normalizer. |
| `npm run check` | PASS | The session controller, sidebar workflows, composer seeding, and desktop API pass strict TypeScript. |
| `npm run build:frontend` | PASS | 303 modules; 410.92 kB JavaScript and 20.95 kB CSS before gzip. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH EXISTING WARNING | The inherited unused `app` setup parameter remains; no new Rust warning was introduced. |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | PASS | Three Rust tests prove valid session deletion, rejection outside the Pi sessions root, and bounded `.jsonl` reads. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities. |
| `npm run gate:sessions-real` | PASS | Real Pi 0.84.2 with `deepseek/deepseek-v4-flash`; new, rename, persisted prompt/history, fork points, fork, switch/resume, three JSONL files, and resume after an actual Pi process restart passed without mocks. |
| Real Windows session UI | PASS | Explicit workspace connection listed only matching real sessions; persisted history, new, rename, fork prompt restoration, and composer clearing were exercised against isolated data. Rapid A→B→A switching converged on A without cross-session messages. |
| Multi-runtime lifecycle | PASS | Separate instance/generation-scoped Pi processes were observed for loaded sessions. Closing the Tauri window reduced three live Pi RPC process trees to zero. |
| Read-only MCO review | PASS WITH FIXES | The review found a transition-state delete edge and an inherited unrestricted session-content read. Both received minimal guards and deterministic tests; speculative composer-seed and duplicate-runtime claims were rejected after tracing the selection guard and path lookup. |
| Static architecture scan | PASS | No Electron dependency or host directories, `window.piBridge`, Browser Agent, or Channels implementation was introduced. |

## Phase 4 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | Fourteen deterministic tests cover safe model normalization, secret-field exclusion, catalog grouping/filtering, ordered thinking levels, per-session model isolation, session selection, and Phase 2 event normalization. |
| `npm run check` | PASS | The Pi model RPC adapter, session-owned model controller, auth metadata API, and React panel pass strict TypeScript. |
| `npm run build:frontend` | PASS | 305 modules; 427.13 kB JavaScript and 28.76 kB CSS before gzip. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH EXISTING WARNING | The inherited Windows-only unused `app` setup parameter remains; no new warning was introduced. |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | PASS | Eight Rust tests include isolated credential removal, metadata-only serialization, provider validation, and preservation of malformed or non-object auth files. No real credential was removed. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities. |
| `npm run gate:models-real` | PASS | Real Pi 0.84.2 returned 355 models; the gate switched `deepseek-v4-flash` to `deepseek-v4-pro`, restored it, changed/restored supported thinking levels, and confirmed the requested model in a fresh Pi process without sending a prompt. |
| Real Windows model UI | PASS | Search/provider grouping, GPT-5.6 Sol/max → DeepSeek V4 Flash/low → restore, cross-session DeepSeek/off isolation, and resume after a full Tauri restart were exercised against real Pi RPC state. |
| Authentication boundary | PASS WITH DOCUMENTED LIMIT | The UI rendered provider names, credential type/source, model counts, refresh, explicit removal confirmation, and `/login` guidance without displaying tokens, headers, endpoints, or auth-file contents. Pi RPC 0.84.2 does not expose interactive login, so no Electron/Node auth host was added. |
| Windows process lifecycle | PASS WITH FIX | Live testing exposed `.cmd`/Volta descendants surviving a single-process kill. The owned PID tree is now terminated on stop/close; two active session runtimes fell to zero after the patched window closed. |
| Read-only MCO Scout | PASS WITH MANUAL VERIFICATION | The scoped model/auth inventory used `pi:deepseek/deepseek-v4-flash`; command names and login limitations were checked against the installed Pi 0.84.2 RPC docs/source before implementation. |
| Static architecture scan | PASS | No Electron dependency or host directories, `window.piBridge`, Browser Agent, Channels, managed runtime, files, or terminal UI was introduced. |

## Phase 5 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | Seventeen deterministic tests include `@file` query extraction, quoted path insertion, ranking, and the earlier chat/model/session coverage. |
| `npm run check` | PASS | The workspace bridge types, file explorer/viewer, composer completion, and image attachment flow pass strict TypeScript. |
| `npm run build:frontend` | PASS | 310 modules; 443.08 kB JavaScript and 35.02 kB CSS before gzip. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH EXISTING WARNING | The inherited Windows-only unused `app` setup parameter remains; no new Rust warning was introduced. |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | PASS | Eleven Rust tests include workspace listing/indexing, traversal/binary/oversize/symlink rejection, real save, and stale-content conflict preservation. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities. The six inherited development-tool advisories remain outside the production tree. |
| Workspace filesystem boundary | PASS | Four narrow Rust commands replace direct WebView filesystem access. Paths are workspace-relative and canonicalized; generated directories and symlinks are skipped; preview/save are limited to existing UTF-8 text files up to 1 MiB. The recursive `$HOME` fs capabilities and direct fs plugin dependencies were removed. |
| Real Windows Files UI | PASS | A connected real workspace loaded root and nested directories lazily, previewed a 75-byte UTF-8 file, inserted a normal `@path`, and quoted a path containing spaces. Save and external-change conflict behavior were exercised at the real filesystem layer by Rust tests; no UI save result is inferred from renderer-only automation. |
| Real Windows image attachment UI | PASS | A repository-owned PNG was selected through the native Windows picker, previewed with its name/size, and removed. It was not sent to a provider. Installed Pi 0.84.2 RPC documentation confirms native image payloads for prompt, steer, and follow-up; the adapter forwards that shape without a custom host. |
| Windows process lifecycle | PASS | `@file` attachment stayed disabled until a real session was ready. Closing the Tauri window ended the development session and left no owned Pi RPC or desktop process. |
| Read-only MCO Scout | PASS WITH MANUAL VERIFICATION | One scoped `pi:deepseek/deepseek-v4-flash` Scout reviewed only the Phase 5 file paths. Its containment and permission recommendations were checked against the implementation and Rust tests. |
| Static architecture scan | PASS | No Electron dependency or host directory, `window.piBridge`, Browser Agent, Channels, terminal/git UI, general WebView fs permission, or direct fs plugin dependency was introduced. |

## Phase 6 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | Seventeen deterministic renderer tests from Phases 2–5 remain green. No mock terminal or Git transport was added. |
| `npm run check` | PASS | xterm lifecycle wiring, typed Git/worktree API, panel switching, and Files dirty-state protection pass strict TypeScript. |
| `npm run build:frontend` | PASS | 316 modules. The main bundle is 452.39 kB and the lazy terminal chunk is 333.94 kB before gzip; no large-chunk warning remains. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH EXISTING WARNING | The inherited Windows-only unused `app` setup parameter remains; no new Rust warning was introduced. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS | Fourteen Rust tests include a real native Windows ConPTY round trip plus a temporary real Git repository covering status, diff, worktree creation, main/dirty refusal, and clean removal. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities. The six inherited development-tool advisories remain outside the production tree. |
| Real Windows Git UI | PASS | `npm run tauri dev` rendered the current branch, 12 real working-tree changes, main/current/dirty worktree guards, and an actual Rust diff while Pi was disconnected. The workspace picker stayed locked while the tool panel was open. |
| Terminal runtime | PASS WITH UI AUTOMATION LIMIT | The native test opened a real ConPTY, answered PowerShell's cursor-position probe, exchanged a marker, and exited cleanly. The xterm renderer compiles and lazy-loads; command entry was not driven by Windows UI automation because the automation safety policy prohibits controlling terminal applications. |
| Capability closure | PASS | Renderer shell execute/spawn/stdin/kill grants were removed. Terminal and Git are available only through typed Rust commands; external-link open remains allow-listed. |
| Worktree safety | PASS | The API validates branch names, chooses an adjacent destination, refuses arbitrary Git arguments and force removal, and rejects main/current/dirty/locked/prunable/missing worktrees. Real create/remove behavior ran only in an isolated temporary repository. |
| Windows process lifecycle | PASS | Closing the real Tauri window ended the development process tree; no workspace-owned `pi-desktop`, Cargo, or Vite process remained. |
| Read-only MCO Scout | PASS WITH FIXES | One scoped `pi:deepseek/deepseek-v4-flash` Scout identified the inherited arbitrary Git command and broad renderer shell permissions. Both were replaced/removed before verification. |
| Static architecture scan | PASS | No Electron host directory, `window.piBridge`, Browser Agent, Channels, arbitrary Git command, or renderer shell process capability was introduced. |

## Phase 7 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | Nineteen deterministic renderer tests include Pi 0.84.2 `sourceInfo` normalization, malformed/duplicate command rejection, and exclusion of unrelated RPC fields. |
| `npm run check` | PASS | The typed ecosystem API, active-session command discovery, composer staging, and React panel pass strict TypeScript. |
| `npm run build:frontend` | PASS | 318 modules. The main bundle is 462.76 kB and the unchanged lazy terminal chunk is 333.94 kB before gzip. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS WITH EXISTING WARNING | Only the inherited Windows-only unused `app` setup parameter remains; no Phase 7 Rust warning was introduced. |
| `cargo test --lib --manifest-path src-tauri/Cargo.toml` | PASS | Seventeen Rust tests include package-list parsing, argument/source validation, workspace-contained local installs, and bounded direct-theme discovery. The existing Windows ConPTY test now allows a five-second exit budget so it remains stable under parallel test load. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities. The inherited development-tool advisories remain outside the production tree. |
| `npm run gate:ecosystem-real` | PASS | Real Pi 0.84.2 completed isolated user install/list/update/remove, verified the project trust boundary, completed approved project install/list/update/remove, and served RPC `get_commands` for a real prompt and skill. The actual Pi settings-file hash was unchanged. |
| Real Windows ecosystem UI | PASS WITH AUTOMATION LIMIT | The default typed Tauri list rendered five user packages, the `Show project` trust gate, and twelve built-in/direct themes. Computer Use transitioned the read-only project list but could not retain the WebView native confirmation for capture/cancellation; no package mutation was performed. An earlier ready real session rendered 26 Pi-reported commands (18 extensions/plugins and 8 skills), and `Use` staged `/agents` without executing it. |
| Package authority boundary | PASS | The arbitrary WebView `run_pi_cli_command` handler was removed. Typed package operations serialize mutations, cap output, time out, stop their owned child on exit, reject option-like sources, and restrict local installs to the selected workspace. Project packages are hidden by default and listed only after explicit trust confirmation. |
| Pi policy boundary | PASS | Install/remove/update/list stay delegated to Pi. User-only operations use `--no-approve`; project list/install/remove/update use Pi's `--approve` only after an explicit trust or full-system-access confirmation. Desktop does not implement gallery recommendations, package filters, or `pi config` policy. |
| Resource/theme boundary | PASS WITH DOCUMENTED LIMIT | Extensions, plugins, skills, and prompts come from live RPC `get_commands/sourceInfo`. Pi 0.84.2 has no RPC theme-list command, so Desktop shows only Pi built-ins plus direct user/project `themes/*.json`; package-owned themes remain represented and managed by their package. |
| Windows process lifecycle | PASS | Closing the verified Tauri window left zero workspace-owned desktop, Vite/Cargo dev, or Pi RPC processes. |
| Read-only MCO Scout | PASS WITH MANUAL CORRECTIONS | One scoped `pi:deepseek/deepseek-v4-flash` Scout informed the boundary. Installed Pi source disproved its stale flat command-field assumption and its blanket no-`--approve` recommendation; implementation follows real 0.84.2 `sourceInfo` and project-write requirements. |
| Static architecture scan | PASS | No Electron dependency/host, `window.piBridge`, Browser Agent, Channels, generic Pi CLI handler, or renderer shell process capability was introduced. |

## Phase 8 verification (2026-08-14, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | Nineteen deterministic renderer tests from Phases 2–7 remain green; no mock runtime installer was introduced. |
| `npm run check` | PASS | Runtime status/settings/install/activate/diagnostics types, the lazy React panel, and the hardened RPC start contract pass strict TypeScript. |
| `npm run build:frontend` | PASS | 320 modules. The main bundle is 464.73 kB, the lazy runtime chunk is 9.08 kB, and the unchanged lazy terminal chunk is 333.94 kB before gzip. |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | PASS | The committed lockfile pins the tested Tauri 2.10 runtime/plugin graph; no Rust diagnostic was emitted. `aws-lc-rs` is absent from the graph. |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` | PASS | Twenty-three Rust tests cover runtime asset mapping, exact checksums, archive traversal rejection, transactional rollback pointers, bounded single-line logs, abandoned-staging locks, and the earlier native bridges. One networked gate remains ignored by default. |
| `npm run gate:runtime-real` | PASS | In an isolated temporary root, the latest official Windows x64 asset and `SHA256SUMS` were downloaded, SHA-256 verified, safely extracted, executed through `pi --version`, activated, and then reused by a second install. The temporary root was removed. |
| `npm audit --omit=dev` | PASS | Zero production vulnerabilities. |
| Real Windows runtime UI | PASS | The panel resolved the existing system Pi 0.84.2 fallback, displayed a local status without startup network polling, showed the explicit install confirmation, and returned to the unchanged state after Cancel. No managed version or active pointer was created. |
| Diagnostics and recovery | PASS | The real panel showed app-data/settings/log paths and `0 RPC / 0 terminal`. A deliberately interrupted staging download was removed on the next startup only after its owner lock was free; `runtime_staging_cleaned` was recorded. |
| Runtime lifecycle boundary | PASS | Runtime maintenance refuses active RPC sessions, RPC start refuses concurrent maintenance, settings are native-owned, WebView-supplied executable/environment fields were removed, and closing the verified app left no `pi-desktop` process. |
| `npm run build` | PASS WITH LINKER INFO | Tauri produced a 16.60 MiB Windows x64 executable, a 5.74 MiB MSI, and a 4.00 MiB NSIS installer. Rust surfaced only the localized MSVC import-library linker message as `linker_messages`; bundling completed successfully. |
| Read-only MCO Scout | PASS WITH MANUAL VERIFICATION | One scoped `pi:deepseek/deepseek-v4-flash` Scout informed release ownership, lifecycle, diagnostics, and rollback boundaries. Asset names, release metadata, Pi version behavior, and all security-sensitive paths were verified against the implementation and real gate. |
| Static architecture scan | PASS | No Electron dependency/host, `window.piBridge`, Browser Agent, Channels, arbitrary runtime executable/environment input, global npm updater, or renderer shell process capability was introduced. |

## Release preparation verification (2026-08-23, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| Independent release identity | PASS | npm, lockfile, Cargo, Tauri, HTML, Linux metainfo, app title, and app-data keys now use Pi GUI / `pi-gui` / `com.pi.gui` / `0.1.0`. Stale Gustav repository package fields were removed; lineage attribution remains. |
| `npm run check:release` with `RELEASE_TAG=v0.1.0` | PASS | The release-critical identity, installer policy, stable WiX upgrade code, and tag/version agreement are enforced. |
| TypeScript, renderer, Rust, frontend, and audit gates | PASS | TypeScript, 19 renderer tests, release metadata, the 320-module frontend build, Cargo check, and full npm audit pass. The real PTY test now waits for the observed DSR before sending CPR and explicitly covers the Windows `cmd.exe` fallback. Both the selected PowerShell path and `cmd.exe` passed six independent test-process runs; the final serial Rust suite passed 24 tests with one network gate ignored. The product xterm path was unchanged. |
| Windows `0.1.0` bundles | PASS WITH EXISTING LINKER INFO | The current candidate rebuild produced a 4,190,762-byte NSIS installer and a 6,021,120-byte MSI. Only the existing localized MSVC import-library linker message was emitted. |
| Generated installer policy | PASS | NSIS is current-user with bundle ID `com.pi.gui`; MSI is per-machine; both use `0.1.0`; downgrades are blocked; WiX uses `bc684a49-735f-5100-8ea3-5bb516c8f702`. |
| MSI administrative extraction and isolated launch | PASS, NOT CLEAN-MACHINE | The MSI contained `pi-gui.exe`, and the extracted binary stayed alive for eight seconds under isolated app-data environment variables. No installer was run on the development machine. |
| Windows Authenticode | BLOCKED | Main EXE, NSIS, and MSI all report `NotSigned`; the signed-release workflow rejects this state. |
| GitHub-hosted clean-machine lifecycle | PASS | [Run 32650837760](https://github.com/fananly233/pi-gui/actions/runs/32650837760) built commit `03d064b` on a fresh Windows runner. The NSIS lifecycle passed install, first launch, same-version update/reinstall, uninstall, shortcut and registry cleanup, and app-data preservation; cross-version upgrade was skipped because no prior Pi GUI release exists. |
| Read-only MCO release Scout | UNAVAILABLE | MCO failed on Windows with `module 'os' has no attribute 'getuid'`; no Scout conclusion was used. |
| Public documentation refresh | PASS | README now introduces Pi GUI, preserves both donor attributions, and documents source install, first use, current limits, data handling, validation, and release status. Inherited Gustav release/package/slash/extension-UI claims were removed from active docs; six donor-only issue/development logs remain local and ignored. |
| Candidate content and `HEAD` secret scan | PASS | 143 tracked/non-ignored candidate files and the current branch history have no detected common key/token/private-key/credential-URL or current-machine home-path hits. The local migration prompt remains ignored and absent from history. |
| Donor archive isolation | PASS WITH PUSH RESTRICTION | A static self-signed smoke key and credential-URL rejection fixtures exist only in local `archive/electron-mvp`, not in `HEAD`. The archive must remain local; `git push --all` and `--mirror` are prohibited. |
| Post-fork commit identity | PASS | After explicit maintainer approval, all 26 derivative commits were rewritten to the connected public GitHub identity and noreply author/committer email. Commit count, linear topology, subjects, dates, and the final tree were unchanged; only derivative SHAs changed. |

## Phase 9 RC stabilization verification (2026-08-23, Windows)

| Check | Result | Notes |
| --- | --- | --- |
| Deterministic source gates | PASS | Release metadata, TypeScript, frontend build, 23 renderer/domain tests, Cargo format/check, 25 Rust tests, full npm audit, and publish-safety checks passed. One explicit managed-runtime network test remains ignored by the deterministic suite. |
| Five real integration gates | PASS | Pi RPC, sessions, models, ecosystem, and managed-runtime gates passed with Pi 0.84.2. Mutable state stayed under disposable roots and the real Pi auth/settings hashes remained unchanged. |
| Native chat/session/file matrix | PASS | Real Tauri UI covered text/thinking/tool streaming, abort/second prompt, restore/rename/fork/switch, file edit/mention/image, stale-write refusal, binary refusal, and models/auth after ready transition. |
| PTY, Git, ecosystem, and runtime matrix | PASS | Real PowerShell PTY lifecycle, Git status/diff/worktree creation, resource inventory, system-Pi fallback, maintenance guard, theme/window controls, and shutdown cleanup passed. No shell command was typed through UI automation. |
| Native confirmation regression | PASS | Cancelling both worktree switch and clean removal preserved the active session/workspace and left the worktree registered and present on disk. All affected renderer callers now await a fail-closed Tauri-native dialog. |
| Native data isolation | PASS | `PI_GUI_DATA_DIR` and the Windows WebView2 profile were redirected to disposable roots. Diagnostics showed only the isolated runtime path; normal runtime and Pi config hashes/timestamps remained unchanged; no test-root process survived shutdown. |
| Hosted lifecycle for Phase 9 tip | PENDING | The earlier `03d064b` hosted lifecycle remains valid historical evidence but does not cover the Phase 9 code changes. CI and Windows Clean-Machine Candidate must rerun after the stabilization branch is pushed. |
| Signing and public release | BLOCKED | Windows artifacts remain unsigned; Apple identities are not configured; no tag, draft, or Release was created. |

## Migration decisions

| Feature | DLYZZT source | Gustav source | Strategy | Priority | Risk | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| Tauri application lifecycle and native plugins | None | `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, capabilities | KEEP_GUSTAV | P0 | Low | Cargo check and real Windows `tauri dev`. |
| Pi process discovery and multi-instance RPC lifecycle | No compatible source | `src-tauri/src/lib.rs` | KEEP_GUSTAV | P0 | Medium | Phase 2 real Pi prompt/stream/abort/second-prompt gate. |
| React renderer entry and shell structure | `src/renderer/main.tsx`, shell layout concepts | `index.html`, `vite.config.ts`, existing renderer entry | REWRITE_MINIMAL | P0 | Low | React shell renders without any Electron host wait state. |
| Warm paper design tokens and theme initialization | `src/renderer/globals.css`, `src/renderer/theme-init.ts` | Existing Tauri theme foundations | PORT_DLYZZT | P0 | Low | Light/dark toggle survives a reload. |
| Runtime information and native window controls | Electron `PiBridge` concepts only | `get_desktop_runtime_info`, Tauri window permissions | ADAPT | P0 | Low | Runtime platform/arch/version render; minimize, maximize/restore, close work. |
| Chat composer and timeline | React chat components | `src/components/chat-view*`, `src/rpc/bridge.ts` | ADAPT | P0 | High | Phase 2 real streaming gate; no mock transport. |
| Pi 0.84.2 event normalization | Electron agent host contracts | Current RPC event stream | REWRITE_MINIMAL | P0 | High | Delta-only `message_update`, strict LF JSONL, tool and abort tests. |
| Sessions and history | Session contracts and presentation ideas | Rust session commands and Lit session browser | ADAPT | P0 | Medium | Phase 3 deterministic race tests, real session RPC gate, isolated Windows UI flows, and process-cleanup check. |
| Models, providers, and authentication | React presentation ideas | Rust auth/provider discovery plus Pi model RPC | ADAPT | P1 | Medium | Phase 4 safe catalog tests, isolated auth-file tests, real model/thinking gate, restart/session isolation, and Windows UI checks. |
| File browsing, editing, `@file`, and image attachments | React file UI ideas | Rust path helpers, native dialog, file-viewer semantics, and Pi image RPC | ADAPT | P1 | Medium | Phase 5 deterministic mention tests, Rust containment/save tests, and real Windows preview/attachment UI checks. |
| Terminal, git, and worktrees | React presentation ideas | Native process/Git foundations | ADAPT | P1 | High | Real ConPTY test, typed Git status/diff, guarded worktree test, real Windows Git UI, and capability scan. |
| Pi packages, extensions, skills, prompts, and themes | Exclude Electron host implementations | Existing CLI/package commands and extension UI concepts | ADAPT | P2 | Medium | Phase 7 typed bridge tests, isolated real Pi mutation gate, live `get_commands`, and Windows UI verification. |
| Managed Pi runtime and release packaging | Bundled-tool concepts only | Existing Tauri sidecar discovery | ADAPT | P2 | High | Locked builds, isolated official-release install/reuse gate, rollback tests, explicit-confirmation UI, startup recovery, and Windows MSI/NSIS bundle generation. |
| Electron main, preload, and agent host | `src/main`, `src/preload`, `src/agent-host` | None | DROP | P0 | Low | Static scan contains no Electron dependency or host bootstrap. |
| Browser Agent and Channels | Browser and Channels trees | None | DROP | P0 | Low | Static scan contains no Browser Agent or Channels source. |

Phase 6 adds a lazy xterm surface backed by a managed native PTY, typed Git status and bounded diffs, and guarded worktree list/create/use/remove flows. It removes the inherited arbitrary Git command and broad renderer shell process capabilities. It does not add stage/commit/fetch/push/reset, force worktree deletion, an unrestricted destination picker, a complete IDE, package management, a managed runtime, Browser Agent, Channels, or mock Pi behavior.

Phase 7 adds typed Pi package list/install/remove/update commands, live extension/plugin/skill/prompt discovery through each session's Pi RPC runtime, direct theme visibility, and command-to-composer staging. Pi remains the package-policy owner. It does not add a package marketplace, recommendations, package-specific settings, automatic command execution, a duplicate `pi config` implementation, managed runtime updates, Browser Agent, Channels, or mock ecosystem data.

Phase 8 adds a versioned app-data-owned Pi runtime, fixed official-release discovery, exact SHA-256 verification, constrained extraction, transactional activation/rollback, explicit system-Pi fallback, lifecycle-only diagnostics, interrupted-install recovery, and locked Windows release bundles. It does not silently update Pi, mutate global npm/PATH, allow the WebView to choose executables or environments, install while a Pi RPC session is active, claim code signing/notarization, or treat bundle generation as a clean-machine installer test.
