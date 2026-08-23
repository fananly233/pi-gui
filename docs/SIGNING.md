# Distribution and signing policy

Last updated: 2026-08-23.

## Source-only decision

Pi GUI uses a **Source-only** distribution policy. The project publishes source code and documentation only. It does not publish or endorse official executables, installers, application bundles, package-manager binaries, or updater payloads.

This decision means:

- no Pi GUI code-signing certificate or legal-identity signing account is required;
- no signing credential, certificate, timestamp service, or signer subject is required or should be configured in GitHub Actions;
- no `.exe`, `.msi`, application bundle, or packaged archive may be attached to a Pi GUI GitHub Release;
- a versioned GitHub Release may contain only GitHub's automatically generated source archives for the exact tag;
- locally built packages are developer builds, not official Pi GUI release artifacts.

The source-only policy supersedes the earlier Phase 10B investigation of Authenticode routes. No signing credential was purchased, created, read, or configured during that investigation.

## Repository enforcement

`npm run check:release` verifies the release identity and source-only boundary. It fails when:

- a binary release-smoke workflow is present;
- the release workflow builds or uploads packaged applications;
- signing credentials or signing configuration are referenced by the release workflow;
- the clean-machine engineering workflow downloads or uploads installer artifacts;
- the README, release template, or this policy stops declaring source-only distribution.

`.github/workflows/release.yml` validates an existing exact version tag and creates or updates a draft with no attached files. GitHub supplies the standard source ZIP and tarball from the tag when the Release is published. The workflow refuses to update an existing draft if it already has attached assets.

`.github/workflows/windows-clean-machine.yml` may still build installers temporarily to test install, launch, update/reinstall, uninstall, and app-data preservation. Those files remain ephemeral on the hosted runner and are not uploaded or treated as release assets.

## Local developer builds

Developers may run or package the application locally:

```powershell
npm ci
npm run check:release
npm run check
npm test
npm run build
```

Local packages inherit the local environment's signing state and are unsupported for public redistribution under the Pi GUI name. The project does not ask users to bypass Windows security warnings for an unofficial package.

## Future policy changes

Binary distribution can return only after an explicit maintainer decision and a separate review of identity disclosure, signing custody, build provenance, update policy, and clean-machine lifecycle evidence. Adding a certificate or an upload step by itself is not enough to change this policy.
