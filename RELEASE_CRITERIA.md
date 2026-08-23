# Pi GUI 0.1 Release Criteria

Last updated: 2026-08-23.

Pi GUI `0.1.0` is an unpublished Windows-only binary release candidate. macOS and Linux remain source-build targets but do not have supported `0.1.0` release assets. A local build or unsigned installer is not a public release.

The current local RC stabilization record is maintained in [docs/RC_ACCEPTANCE.md](./docs/RC_ACCEPTANCE.md). It does not replace signed-release or clean-machine evidence.

## 1. Identity and documentation gate

- [x] Product metadata agrees on `Pi GUI`, `pi-gui`, `com.pi.gui`, and the intended version/tag.
- [x] README explains the product, installation, first-use flow, current limitations, and privacy model.
- [x] README, release notes, license, and `THIRD_PARTY_NOTICES.md` retain Gustav and DLYZZT attribution.
- [x] No document presents donor releases, branches, issue numbers, or smoke results as Pi GUI evidence.
- [x] The public repository URL and private security-reporting route are configured.
- [x] Branding/icon naming is reviewed for the Pi GUI identity.

## 2. Repository and operator privacy gate

- [x] Repository-local Git name is an approved public identity.
- [x] Every post-fork author and committer email uses an approved GitHub noreply address.
- [x] `npm run check:publish` passes.
- [x] `git status --short`, `git diff --check`, and the staged diff are reviewed.
- [x] No `.env`, Pi auth/session data, local app data, signing material, logs, personal paths, or local orchestration notes are tracked.
- [x] Remote URLs contain no embedded credentials.
- [x] Only the reviewed Pi GUI history was pushed. Never use `git push --all` or `git push --mirror`; `archive/electron-mvp` is a local donor-work archive.
- [x] With explicit maintainer approval, move the entire known `%TEMP%\pi-gui-phase9-ui-e97f42c987594cce899a018465edcc3f` fixture to the Recycle Bin and verify that its original path plus the copied Pi auth/settings/model-store files are absent. The app-data quarantine and unrelated Phase 10A native-test directories remained present and untouched.
- [x] Record the maintainer's explicit acceptance of PR #1's obsolete metadata-only merge object. The active mainline and public profile use privacy-safe metadata; no GitHub Support cleanup request is being pursued for `0.1.0`.

Changing existing commit author/committer metadata rewrites commit hashes. It requires explicit approval and must happen before the first public push.

## 3. Deterministic source gate

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
git diff --check
```

All commands must pass. Existing warnings must be recorded exactly and must not be upgraded into a pass claim for a failed check.

## 4. Real integration gate

Run the gates relevant to the release environment:

```powershell
npm run gate:pi-real
npm run gate:sessions-real
npm run gate:models-real
npm run gate:ecosystem-real
npm run gate:runtime-real
```

Record Pi version, operating system, date, and any intentionally isolated state. These gates exercise real Pi/runtime behavior; they are not deterministic unit tests.

The RPC, session, model, ecosystem, and managed-runtime gates must keep mutable Pi state in disposable directories and verify that the real Pi configuration remains unchanged.

## 5. Local bundle gate

- [x] Build the current Windows bundles from the locked graph.
- [x] Inspect product name, identifier, version, installer scope, upgrade identity, downgrade policy, and bundled files.
- [x] Inspect every Windows executable/installer signature and retain `NotSigned` as a release blocker.
- [x] Record local artifact SHA-256 values.
- [x] Label extraction or local executable launch as local smoke only.

On Windows, NSIS is the primary current-user installer. MSI is machine-scoped. A `NotSigned` result blocks public distribution.

## 6. Clean-machine lifecycle gate

Run `.github/workflows/windows-clean-machine.yml` on a fresh hosted Windows runner and record:

- [x] install;
- [x] first launch and process health;
- [x] same-version update/reinstall;
- [x] cross-version upgrade is not applicable to the first `0.1.0` candidate because no earlier Pi GUI release exists;
- [x] uninstall;
- [x] shortcut and registry cleanup;
- [x] app-data preservation.

Do not use the development machine or an administratively extracted EXE as clean-machine evidence.

## 7. Signed release gate

- [x] The credential-free preflight proves the Windows-only workflow gate/order and keeps signing fields out of the checked-in Tauri config.
- [ ] The maintainer has selected either an eligible exportable-PFX route or a separately implemented provider-specific `signCommand` route.
- [ ] Windows NSIS and MSI have valid Authenticode signatures.
- [x] macOS and Linux binary assets are explicitly out of scope for `0.1.0`; no unsupported artifacts are attached to its draft.
- [x] `.github/workflows/release.yml` creates or updates a draft only after both declared Windows artifacts pass release verification.
- [ ] `.github/workflows/release-smoke.yml` passes against the exact signed Windows draft assets.
- [ ] Release notes include lineage, known limitations, install network requirements, and verification links.

## 8. Publish decision

Publish only when sections 1–7 are complete or an item is explicitly documented as not applicable. The maintainer must record the tag, commit SHA, CI URLs, signing identities, artifact hashes, lifecycle evidence, and known issues in `docs/RELEASES.md`.
