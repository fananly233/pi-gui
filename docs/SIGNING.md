# Release signing

Pi GUI does not publish unsigned desktop installers as Releases. The signed-release workflow builds into runner-local staging, verifies every platform, and only then creates or updates a GitHub draft. A missing credential, unexpected signer, absent timestamp, failed notarization, or incomplete artifact set stops before the draft step.

As audited on 2026-08-23, `fananly233/pi-gui` has no repository Actions secrets, variables, or environments configured. The workflow is therefore intentionally blocked until the maintainer supplies real signing identities. Never use a self-signed certificate to turn these gates green.

## Windows

The checked-in workflow supports an exportable PFX certificate through Tauri's native Windows signer. Configure these in **Settings > Secrets and variables > Actions**:

Secrets:

- `WINDOWS_CERTIFICATE`: base64-encoded PFX content.
- `WINDOWS_CERTIFICATE_PASSWORD`: the PFX export password.

Variables:

- `WINDOWS_SIGNING_MODE`: exactly `pfx`.
- `WINDOWS_EXPECTED_SIGNER_SUBJECT`: the exact X.500 `Subject` expected from the imported code-signing certificate.
- `WINDOWS_TIMESTAMP_URL`: the timestamp URL supplied by the certificate issuer.

The runner decodes the PFX under its temporary directory, imports only a currently valid certificate with a private key and the Code Signing EKU, compares the subject, derives the thumbprint, and writes an ignored runner-only Tauri config. The encoded and decoded PFX files are deleted immediately after import; the imported certificate and temporary config are removed after the job.

To encode an eligible PFX on Windows:

```powershell
certutil -encode certificate.pfx certificate-base64.txt
```

Copy the file contents into the GitHub secret, then securely remove the local text export. Do not add either file to this repository.

Tauri warns that its documented exportable-PFX OV path applies only to OV certificates acquired before 2023-06-01. For a modern hardware-backed, cloud/HSM, EV, or issuer-managed certificate, leave `WINDOWS_SIGNING_MODE` unset and implement that provider's command through Tauri `bundle.windows.signCommand`; do not force the certificate into this PFX path. See [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/).

## macOS

The workflow currently supports Developer ID distribution outside the Mac App Store using Apple ID notarization. Configure these repository secrets:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`.
- `APPLE_CERTIFICATE_PASSWORD`: the `.p12` export password.
- `APPLE_ID`: the Apple Developer account email used for notarization.
- `APPLE_PASSWORD`: an app-specific password, not the normal Apple account password.
- `APPLE_TEAM_ID`: the Apple Developer team ID.

The workflow relies on Tauri to infer the signing identity from `APPLE_CERTIFICATE`. Explicit identity selection and App Store Connect API-key notarization are not wired into this workflow; either change requires a reviewed workflow update. See [Tauri macOS code signing](https://v2.tauri.app/distribute/sign/macos/).

## Enforced verification

Before any draft exists, the release workflow requires:

- the checked-out commit to match an existing version tag exactly;
- Windows application, NSIS, and MSI signatures to be `Valid`, use the expected signer subject, and contain a trusted timestamp;
- macOS `codesign`, Gatekeeper, and stapler validation to pass for the app and DMG;
- Linux AppImage and DEB contents to contain the expected binary and metainfo;
- exactly one expected artifact of each release type.

After the draft is created, run **Signed Release Smoke** against the same tag. That workflow downloads the draft assets on fresh hosted runners and independently repeats signature, notarization, package-content, and Windows lifecycle checks. Publishing remains a manual action after the smoke workflow passes.

Tauri updater keys (`TAURI_SIGNING_PRIVATE_KEY`) are a different mechanism from Windows Authenticode and Apple code signing. Pi GUI does not currently ship the updater plugin, so updater keys must not be presented as platform-signing completion.
