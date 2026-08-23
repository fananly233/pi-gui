# Pi GUI Releases

## Current state

`0.1.0` is an unpublished release candidate. The independent repository is [fananly233/pi-gui](https://github.com/fananly233/pi-gui), and the locally generated Windows installers are not signed. No release tag or Pi GUI draft exists. The Gustav project’s releases are upstream history, not Pi GUI releases.

## Repository publication and privacy status

Recorded on Windows on 2026-08-23:

- current tracked/non-ignored candidate files contain no detected common private-key, provider-token, credential-bearing URL, private-config filename, or current-machine home-path value;
- the current Pi GUI `HEAD` history has no detected secret-pattern hits;
- the local migration control prompt is ignored and has never appeared in Git history;
- remote URLs contain no embedded credentials;
- historical test-key and credential-URL fixtures exist only on the local `archive/electron-mvp` donor branch, not in `HEAD`; that branch must not be pushed to the independent repository;
- all derivative commits through the current `HEAD` use the connected public GitHub identity and GitHub noreply author/committer email. The explicitly approved rewrite preserved commit count, topology, subjects, dates, and the final source tree while changing the rewritten commit SHAs;
- six donor-only issue/development logs remain local but are removed from the Git index and covered by exact ignore rules;
- only the reviewed Pi GUI history was pushed to `origin/main`; the generated one-file remote root was replaced with an exact lease after its `fananly` MIT copyright line was retained in `LICENSE`, and its original commit remains recoverable from a local bundle;
- GitHub private vulnerability reporting is enabled and was verified through the dedicated repository API.

`npm run check:publish` now passes across 150 tracked/non-ignored candidate files. It automates the content/history/metadata/remote/attribution checks and redacts suspected values from its output.

The 2026-08-23 GitHub Actions signing audit found zero repository secrets, zero repository variables, and zero environments. Real Windows and Apple identities still have to be configured outside Git. Certificate files and the runner-only Windows signing config are ignored by exact release-safety rules.

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

`.github/workflows/release.yml` no longer lets `tauri-action` create a draft while artifacts are still unverified. It now checks out an existing exact tag, builds into runner-local staging, verifies each platform, and creates or updates a draft only after the complete matrix succeeds.

- Windows supports an eligible exportable PFX path and verifies the app executable, NSIS installer, and MSI against an exact signer subject and trusted timestamp.
- macOS requires a Developer ID certificate plus notarization credentials and verifies `codesign`, Gatekeeper, and stapled notarization tickets.
- Linux verifies AppImage and DEB package contents.
- The final job requires exactly one artifact of every declared type before uploading anything to a draft.

Current secrets are absent, so Windows and macOS stop before building signed artifacts and the draft job cannot run. Provider selection and setup are documented in [SIGNING.md](./SIGNING.md).

## Verification levels

These are separate claims and must not be collapsed into “release verified.”

1. Local build verification checks source, tests, metadata, bundle contents, and signatures. It is not clean-machine evidence.
2. `.github/workflows/windows-clean-machine.yml` starts on a fresh GitHub-hosted Windows runner, builds the unsigned candidate there, and performs install, launch, update/reinstall, uninstall, registry cleanup, and app-data preservation checks.
3. `.github/workflows/release-smoke.yml` downloads release assets on fresh hosted runners. Windows assets must match the configured signer and include trusted timestamps; macOS bundles must pass code-signature, Gatekeeper, and stapler assessment; Linux package contents are checked.

For a later version, provide `previous_tag` to either Windows workflow to exercise a true cross-version NSIS upgrade. For the first `0.1.0` release, the lifecycle gate can only verify the installer’s update/reinstall path because no earlier Pi GUI identity exists.

The PowerShell lifecycle script refuses to install outside the authorized GitHub-hosted Windows workflows unless `-AllowCurrentMachine` is supplied explicitly. Do not use that override as clean-machine evidence.

## Current `0.1.0` evidence

Recorded on Windows on 2026-08-23:

Phase 9 source stabilization has passed the local deterministic, five real-Pi/runtime, and native Tauri acceptance matrix recorded in [RC_ACCEPTANCE.md](./RC_ACCEPTANCE.md). The bundle hashes and hosted lifecycle below were produced from the earlier release-hardening source `03d064b`; they are historical baseline evidence and must not be reused as final Phase 9 artifact evidence. Final bundles, CI, and the hosted Windows lifecycle remain pending for the stabilized candidate.

| Check | Result | Evidence |
| --- | --- | --- |
| Release identity and tag | PASS | `check:release` accepted `v0.1.0` and matched npm, lockfile, Cargo, Tauri, HTML, and Linux metainfo. |
| Pi GUI icon identity | PASS | The inherited `DESK` wordmark/source filename was replaced with a deterministic `GUI` pixel mark and the complete Tauri icon set was regenerated. |
| TypeScript and renderer tests | PASS | Strict check plus 26 deterministic tests, including real-gate isolation/startup timing, RPC readiness, exclusive mutation guards, and native-confirmation safety contracts. |
| Rust check and library tests | PASS | `cargo check --locked` passes. The real PTY test waits until the shell emits DSR before replying with CPR, and a separate Windows test exercises the explicit `cmd.exe` fallback. The current serial library run passed 25 tests with one managed-runtime network gate ignored. |
| Frontend production build | PASS | 320 modules built. |
| Full dependency audit | PASS | Zero reported production or development dependency vulnerabilities after updating the locked Vite 7 toolchain within its existing major version. |
| Windows bundle build | PASS WITH LINKER INFO | Rebuilt the Pi GUI-branded candidate as a 4,188,902-byte NSIS installer and a 6,021,120-byte MSI. The only Rust warning was the localized MSVC import-library linker message. |
| Generated installer metadata | PASS | `Pi GUI`, `0.1.0`, `com.pi.gui`, current-user NSIS, per-machine MSI, fixed upgrade code, and downgrade blocking were present. |
| MSI extraction and isolated executable launch | PASS, NOT CLEAN-MACHINE | Administrative extraction contained `pi-gui.exe`; it remained alive for eight seconds with isolated app-data environment variables. No installer was run on the development machine. |
| Windows signatures | BLOCKED | Main EXE, NSIS, and MSI all report `NotSigned`. |
| Hosted clean-machine lifecycle | PASS | [Run 32650837760](https://github.com/fananly233/pi-gui/actions/runs/32650837760) built `03d064b` on a fresh Windows runner. Install, first launch, same-version update/reinstall, uninstall, shortcut and registry cleanup, and app-data preservation all passed. Cross-version upgrade was skipped because no earlier Pi GUI release exists. |

Pre-Phase9 local bundle SHA-256 values (historical; rebuild before release):

- `pi-gui.exe` (17,406,464 bytes): `13B01F9C21C2432818F69D7A62BFECF8543AF8929A95DDAFD2189566ECA481EF`
- `Pi GUI_0.1.0_x64-setup.exe` (4,188,902 bytes): `4FA8AF048399FBBF235FD209DAD27D58DBF5749A264AD357A930EF4BDED41157`
- `Pi GUI_0.1.0_x64_en-US.msi` (6,021,120 bytes): `5952758A13B941E2951BEA3D76C3640FF31179CC6C32AAC75E7BCA7E762409BE`

Pre-Phase9 hosted evidence:

- source commit: `03d064bf1931b7df003dac4f519a392d0d68a185`;
- [CI run 32650824513](https://github.com/fananly233/pi-gui/actions/runs/32650824513): PASS;
- [Windows clean-machine run 32650837760](https://github.com/fananly233/pi-gui/actions/runs/32650837760): PASS;
- [unsigned Windows artifact 9496313691](https://github.com/fananly233/pi-gui/actions/runs/32650837760/artifacts/9496313691): `pi-gui-windows-unsigned-candidate`, 9,971,044-byte ZIP, SHA-256 `F20806CA1BE04B3BB70952339CCF58DBE2B5B9602311F690DDB978DBF6EB3BD8`, retained by GitHub until 2026-11-21;
- workflow signature observation: `NotSigned`; this run is lifecycle evidence, not permission to publish the artifact.

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
7. Configure Windows signing and macOS signing/notarization according to `docs/SIGNING.md`.
8. Create the exact version tag. The signed-release workflow creates a draft only after local signature/notarization verification succeeds.
9. Run **Signed Release Smoke** against the exact draft assets.
10. Publish only after all required jobs pass and the release notes include attribution.

## Expected artifacts

- macOS: `.dmg` and `.app.tar.gz`
- Windows: NSIS `setup.exe` and `.msi`
- Linux: `.AppImage` and `.deb`

## Evidence checklist

- Phase 9 final commit SHA and tag: PENDING final documentation commit; no release tag exists.
- Phase 9 CI and Windows clean-machine run URLs: PENDING branch push and workflow completion.
- Previous hosted baseline commit: `03d064bf1931b7df003dac4f519a392d0d68a185`.
- Previous CI run URL: [32650824513](https://github.com/fananly233/pi-gui/actions/runs/32650824513), PASS.
- Previous Windows clean-machine run URL: [32650837760](https://github.com/fananly233/pi-gui/actions/runs/32650837760), PASS.
- Signed release-smoke run URL: NOT RUN; no signed draft assets exist.
- Windows NSIS/MSI signer and signature status: no signer; `NotSigned`.
- macOS signing identity and notarization result: NOT CONFIGURED / NOT RUN.
- Install result: PASS on a fresh GitHub-hosted Windows runner.
- Launch result: PASS before and after update/reinstall.
- Same-version update/reinstall result: PASS for `0.1.0`.
- Cross-version upgrade result or first-release N/A justification: N/A because there is no earlier Pi GUI release with the same upgrade identity.
- Uninstall result: PASS; executable, install directory, shortcuts, and uninstall registry key were removed.
- App-data preservation result: PASS across update/reinstall and default uninstall.
- Known issues: Phase 9 hosted lifecycle evidence is pending; the repository has no signing secrets or variables; Windows provider credentials and Apple Developer credentials are not configured, so draft creation, public installer distribution, and signed release smoke remain blocked.
