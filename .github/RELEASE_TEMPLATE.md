# Pi GUI release

Pi GUI is a derivative of [Gustav Pi Desktop](https://github.com/gustavonline/pi-desktop), with selected React UI concepts and visual tokens adapted from [DLYZZT Pi Desktop](https://github.com/DLYZZT/pi-desktop). This is not an official release of either upstream project.

## Highlights

-

## Fixes

-

## Artifacts

- Windows: signed NSIS `setup.exe`, signed `.msi`

Pi GUI `0.1.0` is a Windows-only binary release. macOS and Linux remain source-build targets without supported `0.1.0` release assets.

## Release gates

- [ ] `npm run check:publish` passes and the reviewed branch alone was pushed.
- [ ] Commit author/committer metadata uses approved public identities and noreply email addresses.
- [ ] README, notices, and this release retain Gustav/DLYZZT derivative-work attribution.
- [ ] Tag matches the package, Cargo, Tauri, and Linux metainfo versions.
- [ ] CI and production dependency audit pass.
- [ ] Windows clean-machine install, launch, update/reinstall, uninstall, and app-data preservation pass.
- [ ] Cross-version Windows upgrade passes, or this is the first Pi GUI release and is marked N/A.
- [ ] Windows NSIS and MSI signatures are `Valid`.
- [ ] Windows signer subject and trusted timestamp match the reviewed release configuration.
- [ ] Signed release smoke passes on Windows.
- [ ] Known issues and installation network requirements are documented.
- [ ] Private vulnerability reporting is enabled for the independent repository.

## Verification evidence

- Commit:
- Clean-machine run:
- Signed release-smoke run:
- Signing identities:
- Windows timestamp authority:

## Known limitations

-
