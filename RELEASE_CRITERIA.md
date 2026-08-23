# Pi GUI 0.1 Release Criteria

Last updated: 2026-08-23.

Pi GUI `0.1.0` is an unpublished derivative release candidate. A local build or unsigned installer is not a public release.

## 1. Identity and documentation gate

- [ ] Product metadata agrees on `Pi GUI`, `pi-gui`, `com.pi.gui`, and the intended version/tag.
- [ ] README explains the product, installation, first-use flow, current limitations, and privacy model.
- [ ] README, release notes, license, and `THIRD_PARTY_NOTICES.md` retain Gustav and DLYZZT attribution.
- [ ] No document presents donor releases, branches, issue numbers, or smoke results as Pi GUI evidence.
- [ ] The public repository URL and private security-reporting route are configured.
- [ ] Branding/icon naming is reviewed for the Pi GUI identity.

## 2. Pre-push privacy gate

- [ ] Repository-local Git name is an approved public identity.
- [ ] Every post-fork author and committer email uses an approved GitHub noreply address.
- [ ] `npm run check:publish` passes.
- [ ] `git status --short`, `git diff --check`, and the staged diff are reviewed.
- [ ] No `.env`, Pi auth/session data, local app data, signing material, logs, personal paths, or local orchestration notes are tracked.
- [ ] Remote URLs contain no embedded credentials.
- [ ] Only the reviewed Pi GUI branch is pushed. Never use `git push --all` or `git push --mirror`; `archive/electron-mvp` is a local donor-work archive.

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

## 5. Local bundle gate

- [ ] Build expected platform bundles from the locked graph.
- [ ] Inspect product name, identifier, version, installer scope, upgrade identity, downgrade policy, and bundled files.
- [ ] Inspect every executable/installer signature.
- [ ] Record artifact SHA-256 values.
- [ ] Label extraction or local executable launch as local smoke only.

On Windows, NSIS is the primary current-user installer. MSI is machine-scoped. A `NotSigned` result blocks public distribution.

## 6. Clean-machine lifecycle gate

Run `.github/workflows/windows-clean-machine.yml` on a fresh hosted Windows runner and record:

- [ ] install;
- [ ] first launch and process health;
- [ ] same-version update/reinstall;
- [ ] cross-version upgrade when a prior Pi GUI release exists;
- [ ] uninstall;
- [ ] registry cleanup;
- [ ] app-data preservation.

Do not use the development machine or an administratively extracted EXE as clean-machine evidence.

## 7. Signed release gate

- [ ] Windows NSIS and MSI have valid Authenticode signatures.
- [ ] macOS app and DMG are signed and notarized.
- [ ] Linux package contents and metadata pass smoke checks.
- [ ] `.github/workflows/release.yml` creates a draft only.
- [ ] `.github/workflows/release-smoke.yml` passes against the exact draft assets.
- [ ] Release notes include lineage, known limitations, install network requirements, and verification links.

## 8. Publish decision

Publish only when sections 1–7 are complete or an item is explicitly documented as not applicable. The maintainer must record the tag, commit SHA, CI URLs, signing identities, artifact hashes, lifecycle evidence, and known issues in `docs/RELEASES.md`.
