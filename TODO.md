# Pi GUI Source Release TODO

Last updated: 2026-08-23.

This file tracks Pi GUI only. Gustav's historical releases and issue records remain upstream history rather than Pi GUI evidence.

## Completed product and repository work

- [x] Establish the independent `Pi GUI` / `pi-gui` / `com.pi.gui` / `0.1.0` identity.
- [x] Preserve Gustav MIT and DLYZZT Apache-2.0 attribution and modification notices.
- [x] Implement Phases 1–8 on the Tauri/React/Pi RPC architecture.
- [x] Complete Phase 9 deterministic, real-Pi, native, PTY, and clean-machine stabilization.
- [x] Merge PR #1 with a two-parent merge and verify that its tree matches the reviewed head.
- [x] Use the public GitHub identity and noreply author/committer metadata for active Pi GUI history.
- [x] Add and pass the repository privacy/secret gate; keep the local migration prompt and donor-only notes ignored.
- [x] Configure the independent origin and private vulnerability reporting.
- [x] Record the maintainer's acceptance of PR #1's immutable metadata-only residual.

## Source-only policy transition

- [x] Record the maintainer decision to distribute source code only.
- [x] Remove the signed Windows release-smoke workflow.
- [x] Replace the signed binary release workflow with an exact-tag, zero-asset source draft workflow.
- [x] Stop the clean-machine workflow from downloading or uploading installer artifacts.
- [x] Convert `npm run check:release` into a source-only policy guard.
- [x] Use the `pi-gui-v*` namespace so Pi GUI tags cannot collide with inherited donor `v*` tags.
- [x] Update README, release criteria, roadmap, changelog, security, mapping, and release documentation.
- [x] Keep Tauri packaging and clean-machine lifecycle checks available for local/ephemeral engineering QA.
- [x] Keep all signing credentials unconfigured and out of scope.

## Before the first source release

- [ ] Review and merge the source-only policy branch after CI passes.
- [ ] Run `npm run check:publish`, `npm run check:release`, deterministic tests, Rust checks/tests, frontend build, dependency audit, and `git diff --check` on the exact `main` commit.
- [ ] Confirm release notes retain derivative attribution and clearly state that no official binaries are provided.
- [ ] Obtain explicit maintainer approval before creating `pi-gui-v0.1.0` on the reviewed `main` commit.
- [ ] Let **Source-only Release** create the draft and verify that it has zero attached assets.
- [ ] Confirm the only downloads are GitHub-generated source ZIP and tarball archives.
- [ ] Publish the reviewed draft manually.

## Explicitly out of scope

- Authenticode or other platform signing identities;
- GitHub Release attachments such as EXE, MSI, MSIX, DMG, AppImage, DEB, RPM, or updater payloads;
- package-manager binaries and automatic installer updates;
- treating local or Actions-built packages as supported downloads.
