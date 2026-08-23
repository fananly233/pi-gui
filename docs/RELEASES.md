# Pi GUI Releases

Last updated: 2026-08-23.

## Current state

Pi GUI `0.1.0` is an unpublished **source-only** release candidate. The independent repository is [fananly233/pi-gui](https://github.com/fananly233/pi-gui). No Pi GUI tag, draft, or Release currently exists, and Gustav's historical releases are upstream history rather than Pi GUI releases.

The maintainer decided that Pi GUI will publish source code only. There will be no official Windows, macOS, or Linux executable, installer, application bundle, package-manager binary, or updater payload. A future `0.1.0` GitHub Release may expose only GitHub-generated source ZIP and tarball downloads for the exact tag, with zero attached assets.

This migration checkout retains local `v*` tags fetched from donor repositories, including a donor `v0.1.0`; `origin` has no tags. Pi GUI therefore uses the distinct `pi-gui-v*` namespace. Never run `git push --tags`, `--all`, or `--mirror`, and never reuse an inherited donor tag as a Pi GUI release ref.

## Distribution contract

- The public repository and version tags are the source of truth.
- Release notes retain the Gustav and DLYZZT derivative-work attribution.
- `.github/workflows/release.yml` validates an existing exact tag and creates a source-only draft.
- The workflow never builds, downloads, uploads, signs, or attaches application binaries.
- `.github/workflows/windows-clean-machine.yml` may build installers ephemerally for engineering QA but uploads no artifacts.
- Local packages are unofficial developer builds and must not be represented as Pi GUI release assets.
- No code-signing identity or signing credential is needed under this policy.

The enforceable details are recorded in [SIGNING.md](./SIGNING.md), whose filename is retained to keep existing documentation links stable.

## Release identity

| Field | Value |
| --- | --- |
| Product name | `Pi GUI` |
| Package/binary name | `pi-gui` |
| Application identifier | `com.pi.gui` |
| First derivative version | `0.1.0` |
| Repository | `https://github.com/fananly233/pi-gui` |
| Distribution | Source only; zero attached release assets |

The npm, Cargo, Tauri, Linux metainfo, contribution, issue, and security metadata use this independent identity. Lineage links remain in the README and third-party notices.

## Verification levels

These remain separate claims:

1. Deterministic checks validate repository metadata, TypeScript, renderer tests, frontend output, Rust, and dependencies.
2. Real Pi/runtime gates exercise the configured Pi integration in disposable state.
3. Native Tauri acceptance checks application behavior on the development machine.
4. The optional Windows clean-machine workflow tests ephemeral packages on a fresh hosted runner without retaining them.
5. Source release verification checks the exact tag, repository privacy, attribution, and zero-asset release policy.

Passing a local bundle or clean-machine test does not turn that bundle into a supported download.

## Current `0.1.0` evidence

Recorded on 2026-08-23:

- Phase 9 passed deterministic checks, all five real Pi/runtime gates, isolated native acceptance, and a GitHub-hosted Windows lifecycle run for `867ac378a0eaab9c55c38daecea81b1491b357d2`.
- Phase 10A merged [PR #1](https://github.com/fananly233/pi-gui/pull/1) as `3bb7cc411467fece7d5dbe5edf083d78a836a456`; its tree matches the reviewed PR head. [Mainline CI](https://github.com/fananly233/pi-gui/actions/runs/32664955474) and the [Windows lifecycle run](https://github.com/fananly233/pi-gui/actions/runs/32665181610) passed.
- Phase 10B merged [PR #2](https://github.com/fananly233/pi-gui/pull/2) as the active two-parent merge `26ca58662b33d0f8c85d5ca54a400b79557e2765`; its tree matches the reviewed source-policy head. [Mainline CI #19](https://github.com/fananly233/pi-gui/actions/runs/32672786127) passed with no artifacts.
- Phase 10C [Windows clean-machine run #7](https://github.com/fananly233/pi-gui/actions/runs/32672896200) passed candidate validation, ephemeral installer build, MSI extraction, and the NSIS install/launch/update/uninstall lifecycle for active `main`. The run uploaded no artifact.
- `npm run check:publish` found no common credential/private-key pattern, tracked private-config filename, current-machine home path, credential-bearing remote, or missing derivative-work attribution in the reviewed branch.
- The maintainer accepts the immutable metadata-only residual in GitHub's PR #1 record. Active mainline commits use the approved public GitHub identity and noreply email metadata.
- GitHub initially generated PR #2's merge object with non-approved author-email metadata. The active `main` ref was immediately replaced with the same reviewed tree and parents using the approved public noreply identity. GitHub's immutable PR record may retain the superseded merge-object reference, but it is not the active mainline commit.
- The earlier signing-route audit found no configured repository signing secrets or variables and did not create or access signing credentials.
- Earlier clean-machine runs temporarily uploaded three unsigned Actions artifacts as historical QA evidence. Phase 10C permanently deleted artifact IDs `9496313691`, `9498181296`, and `9499997749`; GitHub now reports an empty artifact list for all three source runs while retaining their workflow logs. The source-only workflow revision prevents future installer artifact uploads, and none of these files was ever a Pi GUI Release asset.

The detailed Phase 9 evidence remains in [RC_ACCEPTANCE.md](./RC_ACCEPTANCE.md). Historical unsigned hashes and signature observations identify tested local bytes only and do not define supported downloads.

## Required source gates

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

Real Pi/runtime gates are required when the release-facing change affects those paths:

```powershell
npm run gate:pi-real
npm run gate:sessions-real
npm run gate:models-real
npm run gate:ecosystem-real
npm run gate:runtime-real
```

## Source release sequence

1. Confirm `package.json`, Cargo, Tauri, Linux metainfo, and the intended tag agree.
2. Run the source gates and review the final diff and commit metadata.
3. Confirm README, `THIRD_PARTY_NOTICES.md`, license files, and release notes retain donor attribution.
4. Push only the reviewed Pi GUI branch. Never push `archive/electron-mvp`, inherited donor tags, `--tags`, `--all`, or `--mirror`.
5. With explicit maintainer approval, create the exact `pi-gui-v0.1.0` tag on the reviewed `main` commit and push only that single tag ref.
6. Let **Source-only Release** validate the tag and create a draft with no attached assets.
7. Confirm the draft exposes only GitHub-generated source archives, then publish it manually.

No tag or Release is created by the policy migration itself.

## Expected `0.1.0` downloads

- GitHub-generated `Source code (zip)`;
- GitHub-generated `Source code (tar.gz)`;
- no attached files.

In particular, `.exe`, `.msi`, `.msix`, `.dmg`, `.app`, `.deb`, `.rpm`, AppImage, updater payloads, and package-manager binaries are out of scope.
