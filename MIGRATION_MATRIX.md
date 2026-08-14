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
| Sessions and history | Session contracts and presentation ideas | Rust session commands and Lit session browser | ADAPT | P0 | Medium | Phase 3 list/open/resume/fork against real session files. |
| Models, providers, and authentication | React presentation ideas | Rust auth/model commands | ADAPT | P1 | Medium | Phase 4 provider discovery and login/logout diagnostics. |
| File browsing and editing | React file UI ideas | Tauri fs/dialog plugins and file viewer | ADAPT | P1 | Medium | Phase 5 open/save plus capability-scope checks. |
| Terminal, git, and worktrees | React presentation ideas | Shell capability allow-list and Rust git commands | ADAPT | P1 | High | Phase 6 shell lifecycle, git status, and worktree safety tests. |
| Pi packages, extensions, skills, and prompts | Exclude Electron host implementations | Existing CLI/package commands and extension UI | ADAPT | P1 | Medium | Phase 7 real list/install/remove/update flows. |
| Managed Pi runtime and release packaging | Bundled-tool concepts only | Existing Tauri sidecar discovery | DEFER | P2 | High | Phase 8 clean-machine install and upgrade gate. |
| Electron main, preload, and agent host | `src/main`, `src/preload`, `src/agent-host` | None | DROP | P0 | Low | Static scan contains no Electron dependency or host bootstrap. |
| Browser Agent and Channels | Browser and Channels trees | None | DROP | P0 | Low | Static scan contains no Browser Agent or Channels source. |

Phase 1 stops after the React shell and thin native desktop API. It does not introduce `window.piBridge`, `PiAdapter`, `EventNormalizer`, chat, sessions, or mock Pi behavior.
