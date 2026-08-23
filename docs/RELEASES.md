# Pi GUI Releases

## Current state

`0.1.0` is an unpublished release candidate. Pi GUI has no independent `origin` remote yet, and the locally generated Windows installers are not signed. The Gustav project’s releases are upstream history, not Pi GUI releases.

## Release identity

| Field | Value |
| --- | --- |
| Product name | `Pi GUI` |
| Package/binary name | `pi-gui` |
| Application identifier | `com.pi.gui` |
| First derivative version | `0.1.0` |
| Windows publisher metadata | `Pi GUI contributors` |
| WiX upgrade code | `bc684a49-735f-5100-8ea3-5bb516c8f702` |

The package deliberately omits homepage, repository, and issue-tracker URLs until an independent repository is connected. Lineage links remain in the README and third-party notices.

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

## Verification levels

These are separate claims and must not be collapsed into “release verified.”

1. Local build verification checks source, tests, metadata, bundle contents, and signatures. It is not clean-machine evidence.
2. `.github/workflows/windows-clean-machine.yml` starts on a fresh GitHub-hosted Windows runner, builds the unsigned candidate there, and performs install, launch, update/reinstall, uninstall, registry cleanup, and app-data preservation checks.
3. `.github/workflows/release-smoke.yml` downloads release assets on fresh hosted runners. Windows assets must be signed; macOS bundles must pass code-signature and Gatekeeper assessment; Linux package contents are checked.

For a later version, provide `previous_tag` to either Windows workflow to exercise a true cross-version NSIS upgrade. For the first `0.1.0` release, the lifecycle gate can only verify the installer’s update/reinstall path because no earlier Pi GUI identity exists.

The PowerShell lifecycle script refuses to install outside the authorized GitHub-hosted Windows workflows unless `-AllowCurrentMachine` is supplied explicitly. Do not use that override as clean-machine evidence.

## Current `0.1.0` local evidence

Recorded on Windows on 2026-08-23:

| Check | Result | Evidence |
| --- | --- | --- |
| Release identity and tag | PASS | `check:release` accepted `v0.1.0` and matched npm, lockfile, Cargo, Tauri, HTML, and Linux metainfo. |
| TypeScript and renderer tests | PASS | Strict check plus 19 deterministic tests. |
| Rust check and library tests | PASS | 23 tests passed; the one networked managed-runtime gate remained ignored by design. |
| Frontend production build | PASS | 320 modules built. |
| Full dependency audit | PASS | Zero reported production or development dependency vulnerabilities after updating the locked Vite 7 toolchain within its existing major version. |
| Windows bundle build | PASS WITH LINKER INFO | Produced a 4,187,406-byte NSIS installer and a 6,021,120-byte MSI. The only Rust warning was the localized MSVC import-library linker message. |
| Generated installer metadata | PASS | `Pi GUI`, `0.1.0`, `com.pi.gui`, current-user NSIS, per-machine MSI, fixed upgrade code, and downgrade blocking were present. |
| MSI extraction and isolated executable launch | PASS, NOT CLEAN-MACHINE | Administrative extraction contained `pi-gui.exe`; it remained alive for eight seconds with isolated app-data environment variables. No installer was run on the development machine. |
| Windows signatures | BLOCKED | Main EXE, NSIS, and MSI all report `NotSigned`. |
| Hosted clean-machine lifecycle | NOT RUN | Workflow is prepared, but this checkout has no independent `origin` from which to execute it. |

Candidate SHA-256 values:

- `pi-gui.exe`: `3E8DA926D49F7F7D0046DF9F11CC53E43C69598A61BECD06BDB6B7E19017F4E4`
- `Pi GUI_0.1.0_x64-setup.exe`: `E68DDF66EC0BF7B2AC873F94ED551978EB5EC3407588F064A49D5B396AFFE970`
- `Pi GUI_0.1.0_x64_en-US.msi`: `9BAA6D8D032AB967338D47A7DFB772A7F868AB42A9273C3C343CA4D8203858E0`

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

## Release sequence

1. Confirm `package.json`, Cargo, Tauri, Linux metainfo, and the intended tag all agree.
2. Run the local gates and record exact results.
3. Connect an independent repository whose README and release notes retain the derivative-work declaration.
4. Push the reviewed commit without rewriting or merging the donor histories.
5. Run **Windows Clean-Machine Candidate**. A cross-version upgrade result is required once a prior Pi GUI release exists.
6. Configure Windows signing and macOS signing/notarization. The current workflow intentionally creates a draft release only.
7. Run **Signed Release Smoke** against the draft assets.
8. Publish only after all required jobs pass and the release notes include attribution.

## Expected artifacts

- macOS: `.dmg` and `.app.tar.gz`
- Windows: NSIS `setup.exe` and `.msi`
- Linux: `.AppImage` and `.deb`

## Evidence checklist

- Commit SHA and tag:
- CI run URL:
- Windows clean-machine run URL:
- Signed release-smoke run URL:
- Windows NSIS/MSI signer and signature status:
- macOS signing identity and notarization result:
- Install result:
- Launch result:
- Same-version update/reinstall result:
- Cross-version upgrade result or first-release N/A justification:
- Uninstall result:
- App-data preservation result:
- Known issues:
