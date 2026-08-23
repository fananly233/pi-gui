# Pi GUI Releases

## Current state

`0.1.0` is an unpublished Windows-only binary release candidate. The independent repository is [fananly233/pi-gui](https://github.com/fananly233/pi-gui), and the locally generated Windows installers are not signed. macOS and Linux remain source-build targets without supported `0.1.0` release assets. No release tag or Pi GUI draft exists. The Gustav project’s releases are upstream history, not Pi GUI releases.

## Repository publication and privacy status

Recorded on Windows on 2026-08-23:

- current tracked/non-ignored candidate files contain no detected common private-key, provider-token, credential-bearing URL, private-config filename, or current-machine home-path value;
- the current Pi GUI `HEAD` history has no detected secret-pattern hits;
- the local migration control prompt is ignored and has never appeared in Git history;
- remote URLs contain no embedded credentials;
- historical test-key and credential-URL fixtures exist only on the local `archive/electron-mvp` donor branch, not in `HEAD`; that branch must not be pushed to the independent repository;
- all derivative commits through the current `HEAD` use the connected public GitHub identity and GitHub noreply author/committer email. The explicitly approved rewrite preserved commit count, topology, subjects, dates, and the final source tree while changing the rewritten commit SHAs;
- PR #1 is merged and the active `main` merge commit preserves the exact reviewed parents and source tree with noreply metadata. GitHub's immutable PR record still identifies its first generated merge object; removing that historical platform record would require GitHub Support;
- six donor-only issue/development logs remain local but are removed from the Git index and covered by exact ignore rules;
- only the reviewed Pi GUI history was pushed to `origin/main`; the generated one-file remote root was replaced with an exact lease after its `fananly` MIT copyright line was retained in `LICENSE`, and its original commit remains recoverable from a local bundle;
- GitHub private vulnerability reporting is enabled and was verified through the dedicated repository API.

`npm run check:publish` now passes across 150 tracked/non-ignored candidate files. It automates the content/history/metadata/remote/attribution checks and redacts suspected values from its output.

The 2026-08-23 GitHub configuration audit found zero repository Actions secrets, zero repository Actions variables, zero Dependabot secrets, and zero Codespaces secrets. Copilot review created one empty `copilot` environment with no protection rules, secrets, or variables; it contains no signing or private configuration. A real Windows signing identity still has to be configured outside Git. Certificate files and the runner-only Windows signing config are ignored by exact release-safety rules.

## Release identity

| Field | Value |
| --- | --- |
| Product name | `Pi GUI` |
| Package/binary name | `pi-gui` |
| Application identifier | `com.pi.gui` |
| First derivative version | `0.1.0` |
| Windows publisher metadata | `Pi GUI contributors` |
| WiX upgrade code | `bc684a49-735f-5100-8ea3-5bb516c8f702` |

The npm, Cargo, Linux metainfo, contribution, issue, and security metadata point to `https://github.com/fananly233/pi-gui`. Lineage links remain in the README and third-party notices.

## Windows installer policy

| Bundle | Policy |
| --- | --- |
| NSIS `setup.exe` | Primary installer; current-user scope; no elevation expected for the normal path. |
| MSI | Administrator-oriented bundle; Tauri/WiX uses machine scope. |
| Downgrade | Disabled. |
| Upgrade identity | Stable application identifier and explicit WiX upgrade code. |
| App data | Default uninstall must preserve `%APPDATA%\com.pi.gui`. |
| WebView2 | `downloadBootstrapper`; installation may need network access when WebView2 is absent. |
| Signing | A public Windows release must have valid Authenticode signatures on both NSIS and MSI assets. |

## Signed-release workflow

`.github/workflows/release.yml` no longer lets `tauri-action` create a draft while artifacts are still unverified. For the Windows-only `0.1.0` scope, it checks out an existing exact tag, builds into runner-local staging, and creates or updates a draft only after the signed Windows application, NSIS installer, and MSI pass verification.

- Windows supports an eligible exportable PFX path and verifies the app executable, NSIS installer, and MSI against an exact signer subject and trusted timestamp.
- The final job requires exactly one NSIS installer and one MSI before uploading anything to a draft.
- macOS and Linux artifacts are not built or accepted by the `0.1.0` release workflow.

Current Windows signing secrets and variables are absent, so the workflow stops before building signed artifacts and the draft job cannot run. Provider selection and setup are documented in [SIGNING.md](./SIGNING.md).

## Verification levels

These are separate claims and must not be collapsed into “release verified.”

1. Local build verification checks source, tests, metadata, bundle contents, and signatures. It is not clean-machine evidence.
2. `.github/workflows/windows-clean-machine.yml` starts on a fresh GitHub-hosted Windows runner, builds the unsigned candidate there, and performs install, launch, update/reinstall, uninstall, registry cleanup, and app-data preservation checks.
3. `.github/workflows/release-smoke.yml` downloads the two Windows release assets on a fresh hosted runner. Both must match the configured signer and include trusted timestamps before the NSIS lifecycle test runs.

For a later version, provide `previous_tag` to either Windows workflow to exercise a true cross-version NSIS upgrade. For the first `0.1.0` release, the lifecycle gate can only verify the installer’s update/reinstall path because no earlier Pi GUI identity exists.

The PowerShell lifecycle script refuses to install outside the authorized GitHub-hosted Windows workflows unless `-AllowCurrentMachine` is supplied explicitly. Do not use that override as clean-machine evidence.

## Current `0.1.0` evidence

Recorded on Windows on 2026-08-23:

Phase 10A integrated [PR #1](https://github.com/fananly233/pi-gui/pull/1) into `main` as a two-parent merge commit. The active merge commit is `3bb7cc411467fece7d5dbe5edf083d78a836a456`; its parents are the reviewed base `4147e6a48142a63ad701dec0d13b7a659ca3b2b9` and PR head `ef758c0ab7e24724de50db71cba8655918770577`, and its tree is identical to that PR head.

| Phase 10A check | Result | Evidence |
| --- | --- | --- |
| Mainline CI | PASS | [Run 32664955474](https://github.com/fananly233/pi-gui/actions/runs/32664955474) passed for `3bb7cc4`. |
| Windows clean-machine lifecycle | PASS | [Run 32665181610](https://github.com/fananly233/pi-gui/actions/runs/32665181610) passed validation, NSIS/MSI build, MSI extraction, install, launch, same-version update/reinstall, uninstall, cleanup, and app-data preservation for `3bb7cc4`. |
| Native Windows smoke | PASS | The isolated release EXE showed `windows / x86_64` and Desktop `v0.1.0`; theme switching and restart persistence, maximize/restore, application close, and process exit passed without touching the live Pi agent directory. |
| Publication safety | PASS WITH PLATFORM RESIDUAL | The active mainline history passes `npm run check:publish` with noreply metadata. GitHub retains the first merge object in the immutable PR record as noted above. |
| Release boundary | BLOCKED | The hosted candidate artifact remains unsigned. No tag, draft, Release, or signing credential was created or configured. |

Phase 9 source stabilization passed the local deterministic, five real-Pi/runtime, native Tauri, and hosted Windows lifecycle matrix recorded in [RC_ACCEPTANCE.md](./RC_ACCEPTANCE.md). The tested runtime/source commit is `867ac378a0eaab9c55c38daecea81b1491b357d2`; the evidence-only documentation update after that commit does not alter bundled application inputs. No release tag exists.

| Check | Result | Evidence |
| --- | --- | --- |
| Release identity and tag | PASS | `check:release` accepted `v0.1.0` and matched npm, lockfile, Cargo, Tauri, HTML, and Linux metainfo. |
| Pi GUI icon identity | PASS | The inherited `DESK` wordmark/source filename was replaced with a deterministic `GUI` pixel mark and the complete Tauri icon set was regenerated. |
| TypeScript and renderer tests | PASS | Strict check plus 26 deterministic tests, including real-gate isolation/startup timing, RPC readiness, exclusive mutation guards, and native-confirmation safety contracts. |
| Rust check and library tests | PASS | `cargo check --locked` passes. The real PTY test waits until the shell emits DSR before replying with CPR, and a separate Windows test exercises the explicit `cmd.exe` fallback. The current serial library run passed 25 tests with one managed-runtime network gate ignored. |
| Frontend production build | PASS | 321 modules built. |
| Full dependency audit | PASS | Zero reported production or development dependency vulnerabilities after updating the locked Vite 7 toolchain within its existing major version. |
| Windows bundle build | PASS WITH LINKER INFO | Rebuilt the exact Phase 9 candidate as a 17,401,856-byte application, 4,189,296-byte NSIS installer, and 6,017,024-byte MSI. The only Rust warning was the localized MSVC import-library linker message. |
| Generated installer metadata | PASS | `Pi GUI`, `0.1.0`, `com.pi.gui`, current-user NSIS, per-machine MSI, fixed upgrade code, and downgrade blocking were present. |
| Windows signatures | BLOCKED | Main EXE, NSIS, and MSI all report `NotSigned`. |
| Hosted clean-machine lifecycle | PASS | [Run 32658152422](https://github.com/fananly233/pi-gui/actions/runs/32658152422) built `867ac37` on a fresh Windows runner. MSI extraction, NSIS install, first launch, same-version update/reinstall, uninstall, shortcut and registry cleanup, and app-data preservation all passed. Cross-version upgrade was skipped because no earlier Pi GUI release exists. |

Phase 9 local bundle SHA-256 values:

- `pi-gui.exe` (17,401,856 bytes): `B47DB7C8156537FA59E8AF731D496191A0CF9E4B84E7EB153899C81491B15CFB`
- `Pi GUI_0.1.0_x64-setup.exe` (4,189,296 bytes): `5AA66F3777D7E7FF19C2E7DD57198C53F72C734E4215D306E77885748D3E1CCA`
- `Pi GUI_0.1.0_x64_en-US.msi` (6,017,024 bytes): `94FBE5710381DD35FB759A32EC32B2DBDA32F54D053138E06CEA29DCF2D0F70E`

Phase 9 hosted evidence:

- tested source commit: `867ac378a0eaab9c55c38daecea81b1491b357d2`;
- [CI run 32658150459](https://github.com/fananly233/pi-gui/actions/runs/32658150459): PASS;
- [Windows clean-machine run 32658152422](https://github.com/fananly233/pi-gui/actions/runs/32658152422): PASS;
- [unsigned Windows artifact 9498181296](https://github.com/fananly233/pi-gui/actions/runs/32658152422/artifacts/9498181296): `pi-gui-windows-unsigned-candidate`, 9,954,766-byte ZIP, digest `sha256:74f3c4ca878b6302f74f633c04d25dea4114291ba5a76347b5f25b7fb782104d`, retained until 2026-11-21T18:28:35Z;
- workflow signature observation: `NotSigned`; this run is lifecycle evidence, not permission to publish the artifact.

The earlier `03d064bf1931b7df003dac4f519a392d0d68a185` lifecycle remains historical baseline evidence only: [CI 32650824513](https://github.com/fananly233/pi-gui/actions/runs/32650824513) and [clean-machine 32650837760](https://github.com/fananly233/pi-gui/actions/runs/32650837760).

## Required local gates

```powershell
$env:RELEASE_TAG = "v0.1.0"
npm ci
npm run check:release
npm run check
npm test
npm run build:frontend
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm audit
npm run tauri -- build --bundles nsis,msi
```

Also inspect generated WiX/NSIS metadata and run `Get-AuthenticodeSignature` on every Windows artifact. An unsigned result is a release blocker, not a warning to waive.

Before the first public push, also run:

```powershell
npm run check:publish
git status --short
git diff --check
git diff --cached
```

Push only the reviewed Pi GUI branch after the gate passes. Do not push `archive/electron-mvp`, use `git push --all`, or use `git push --mirror`.

## Release sequence

1. Confirm `package.json`, Cargo, Tauri, Linux metainfo, and the intended tag all agree.
2. Run the local gates and record exact results.
3. Re-run `check:publish` on the final clean commit and review the branch diff against the Gustav base.
4. Confirm the independent repository URL, derivative-work declaration, and private vulnerability-reporting setting.
5. Push only the reviewed Pi GUI history without merging or pushing donor-only histories.
6. Run **Windows Clean-Machine Candidate**. A cross-version upgrade result is required once a prior Pi GUI release exists.
7. Configure Windows signing according to `docs/SIGNING.md`.
8. Create the exact version tag. The signed-release workflow creates a draft only after local signature/notarization verification succeeds.
9. Run **Signed Windows Release Smoke** against the exact draft assets.
10. Publish only after all required jobs pass and the release notes include attribution.

## Expected `0.1.0` artifacts

- Windows: NSIS `setup.exe` and `.msi`

No macOS or Linux binary is part of the supported `0.1.0` release. Their source-build metadata remains in the repository for future work.

## Evidence checklist

- Phase 10A active mainline merge commit: `3bb7cc411467fece7d5dbe5edf083d78a836a456`; reviewed source tree matches PR head `ef758c0ab7e24724de50db71cba8655918770577`.
- Phase 10A mainline CI and Windows clean-machine runs: [32664955474](https://github.com/fananly233/pi-gui/actions/runs/32664955474) and [32665181610](https://github.com/fananly233/pi-gui/actions/runs/32665181610), both PASS.
- Phase 10A unsigned Windows artifact: [9499997749](https://github.com/fananly233/pi-gui/actions/runs/32665181610/artifacts/9499997749), `pi-gui-windows-unsigned-candidate`, 9,956,736-byte ZIP, digest `sha256:3fa655fa6f51ae00b24f23c2b46648f64c337e46415eabef8babd64bfda29d31`, retained until 2026-11-21T20:41:23Z.
- Phase 9 tested runtime/source commit: `867ac378a0eaab9c55c38daecea81b1491b357d2`; no release tag exists.
- Phase 9 CI and Windows clean-machine runs: [32658150459](https://github.com/fananly233/pi-gui/actions/runs/32658150459) and [32658152422](https://github.com/fananly233/pi-gui/actions/runs/32658152422), both PASS.
- Previous hosted baseline commit: `03d064bf1931b7df003dac4f519a392d0d68a185`.
- Previous CI run URL: [32650824513](https://github.com/fananly233/pi-gui/actions/runs/32650824513), PASS.
- Previous Windows clean-machine run URL: [32650837760](https://github.com/fananly233/pi-gui/actions/runs/32650837760), PASS.
- Signed release-smoke run URL: NOT RUN; no signed draft assets exist.
- Windows NSIS/MSI signer and signature status: no signer; `NotSigned`.
- macOS and Linux release assets: NOT APPLICABLE to the Windows-only `0.1.0` scope.
- Install result: PASS on a fresh GitHub-hosted Windows runner.
- Launch result: PASS before and after update/reinstall.
- Same-version update/reinstall result: PASS for `0.1.0`.
- Cross-version upgrade result or first-release N/A justification: N/A because there is no earlier Pi GUI release with the same upgrade identity.
- Uninstall result: PASS; executable, install directory, shortcuts, and uninstall registry key were removed.
- App-data preservation result: PASS across update/reinstall and default uninstall.
- Known issues: the repository has no Windows signing secrets or variables, so draft creation, public installer distribution, and signed release smoke remain blocked.
