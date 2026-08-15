# Pi Desktop Tauri Migration Matrix

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
| Terminal, git, and worktrees | React presentation ideas | Shell capability allow-list and Rust git commands | ADAPT | P1 | High | Phase 6 shell lifecycle, git status, and worktree safety tests. |
| Pi packages, extensions, skills, and prompts | Exclude Electron host implementations | Existing CLI/package commands and extension UI | ADAPT | P1 | Medium | Phase 7 real list/install/remove/update flows. |
| Managed Pi runtime and release packaging | Bundled-tool concepts only | Existing Tauri sidecar discovery | DEFER | P2 | High | Phase 8 clean-machine install and upgrade gate. |
| Electron main, preload, and agent host | `src/main`, `src/preload`, `src/agent-host` | None | DROP | P0 | Low | Static scan contains no Electron dependency or host bootstrap. |
| Browser Agent and Channels | Browser and Channels trees | None | DROP | P0 | Low | Static scan contains no Browser Agent or Channels source. |

Phase 5 adds a workspace-scoped native file explorer, bounded UTF-8 preview/editor, conflict-aware save, local `@file` completion/insertion, and image picker/paste/drop previews that map directly to Pi RPC image payloads. It does not expose a general filesystem bridge, create/delete files, import DLYZZT's Electron host, or claim an image-provider round trip that was not run. Terminal/git, package management, managed runtime, Browser Agent, Channels, and mock Pi behavior remain absent.
