# Pi GUI 0.1 Source Release Criteria

Last updated: 2026-08-23.

Pi GUI `0.1.0` is a source-only release candidate. A public Release may contain only GitHub-generated archives for the exact source tag and must have zero attached assets. Local or CI-built applications and installers are engineering outputs, not release artifacts.

## 1. Identity and documentation

- [x] Product metadata agrees on `Pi GUI`, `pi-gui`, `com.pi.gui`, and `0.1.0`.
- [x] README explains the product, source prerequisites, first-use flow, limitations, and privacy model.
- [x] README, release notes, license files, and `THIRD_PARTY_NOTICES.md` retain Gustav and DLYZZT attribution.
- [x] No document presents donor releases, branches, issue numbers, or smoke results as Pi GUI release evidence.
- [x] Repository, issue, and private security-reporting routes use the independent project.
- [x] Active release documentation declares source-only distribution and no official binaries.

## 2. Repository and operator privacy

- [x] Repository-local Git metadata uses the approved public identity and GitHub noreply email addresses.
- [x] `npm run check:publish` passes.
- [x] No `.env`, Pi auth/session data, local app data, signing material, logs, personal paths, or local orchestration notes are tracked.
- [x] Remote URLs contain no embedded credentials.
- [x] Only reviewed Pi GUI history is pushed; `archive/electron-mvp` remains local.
- [x] The maintainer accepts PR #1's immutable metadata-only residual.

## 3. Deterministic source gate

```powershell
$env:RELEASE_TAG = "pi-gui-v0.1.0"
npm ci
npm run check:publish
npm run check:release
npm run check
npm test
npm run build:frontend
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm audit
git diff --check
```

All commands must pass. Existing warnings must be recorded exactly and cannot be converted into pass claims for failed checks.

## 4. Integration evidence

Run the real gates when release-facing changes touch their paths:

```powershell
npm run gate:pi-real
npm run gate:sessions-real
npm run gate:models-real
npm run gate:ecosystem-real
npm run gate:runtime-real
```

The Phase 9 and Phase 10A records establish the current real-Pi, native Tauri, and clean-machine baseline. A documentation/workflow-only source-policy change does not require rerunning mutable integration gates, but it must not claim new runtime evidence.

## 5. Source-only automation

- [x] `.github/workflows/release.yml` validates an existing exact tag and creates or updates only a draft.
- [x] The release workflow contains no application build, signing, artifact upload, or release-asset upload step.
- [x] Pi GUI release tags use `pi-gui-v*`, avoiding collisions with inherited donor `v*` tags.
- [x] `.github/workflows/release-smoke.yml` is absent because there are no binary release assets to test.
- [x] `.github/workflows/windows-clean-machine.yml` retains ephemeral lifecycle QA but does not download or upload installer artifacts.
- [x] `npm run check:release` rejects reintroduction of the retired binary publishing path.
- [x] The release template requires zero attached assets and identifies local bundles as unofficial.

Code signing is not a source-release gate. No signer identity, certificate, timestamp authority, or signing secret should be configured for this release policy.

## 6. Publish decision

- [ ] The intended source commit is merged to `main` and CI passes on that exact commit.
- [ ] The maintainer explicitly authorizes creation of the exact `pi-gui-v0.1.0` tag on the reviewed `main` commit.
- [ ] **Source-only Release** passes for that tag and creates a draft.
- [ ] The draft has zero attached assets and shows only GitHub-generated source ZIP/tarball downloads.
- [ ] Release notes contain lineage, source-build prerequisites, limitations, and verification links.
- [ ] The maintainer manually publishes the reviewed source-only draft.

Do not create a tag or Release merely because sections 1–5 pass. Tag creation and publication remain separate, explicit maintainer actions.
