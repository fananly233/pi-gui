# Release signing

Pi GUI does not publish unsigned desktop installers as Releases. The `0.1.0` signed-release workflow is Windows-only: it builds into runner-local staging, verifies the application, NSIS installer, and MSI, and only then creates or updates a GitHub draft. A missing credential, unexpected signer, absent timestamp, or incomplete artifact set stops before the draft step.

As audited on 2026-08-23, `fananly233/pi-gui` has no repository Actions secrets or variables. The only environment is an empty `copilot` environment with no protection rules, secrets, or variables. The workflow is therefore intentionally blocked until the maintainer supplies a real Windows signing identity. Never use a self-signed certificate to turn these gates green. This audit inspected only checked-in workflow/configuration structure and the absence of configured secret/variable names; it did not read, create, or configure signing credential values.

## Windows route decision

The Phase 10B-A route decision is `UNDECIDED`. The repository is ready for only one conditional route; choosing or purchasing a certificate remains a maintainer decision.

| Route | Repository status | Use boundary |
| --- | --- | --- |
| Eligible exportable PFX through Tauri's native Windows signer | Implemented and covered by `npm run check:release` | Use only when the issuer confirms that the certificate can be exported and used by this path. Tauri documents its legacy OV-PFX guidance for certificates acquired before 2023-06-01. |
| Modern hardware-backed, cloud/HSM, EV, issuer-managed, or post-2023 OV certificate | Not implemented | Select a provider first, then add and review that provider's `bundle.windows.signCommand` in a separate phase. Do not force this material into the PFX workflow. |
| Tauri updater key | Out of scope | It signs updater payload metadata; it does not satisfy Windows Authenticode. |

The checked-in Tauri config deliberately contains no certificate thumbprint, timestamp URL, or `signCommand`. The release workflow creates an ignored runner-only override only after its PFX gate succeeds.

## Implemented PFX route

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

Tauri warns that its documented exportable-PFX OV path applies only to OV certificates acquired before 2023-06-01. For a modern hardware-backed, cloud/HSM, EV, issuer-managed, or post-2023 OV certificate, leave `WINDOWS_SIGNING_MODE` unset and implement that provider's command through Tauri `bundle.windows.signCommand`; do not force the certificate into this PFX path. See [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/).

## Credential-free preflight

Run this before selecting or configuring a signing identity:

```powershell
$env:RELEASE_TAG = "v0.1.0"
npm run check:release
```

The preflight reads repository files only. It verifies release identity, Windows-only scope, the explicit legacy-PFX gate, runner-only signing configuration, build/verification/draft ordering, and the signed-smoke ordering. It fails if signing fields are added to the checked-in Tauri config. A pass means the release route is structurally gated; it does not mean a certificate exists, an installer is signed, or a release may be published.

## Enforced verification

Before any draft exists, the release workflow requires:

- the checked-out commit to match an existing version tag exactly;
- Windows application, NSIS, and MSI signatures to be `Valid`, use the expected signer subject, and contain a trusted timestamp;
- exactly one NSIS installer and one MSI to be staged for the draft;
- no macOS or Linux artifact to be treated as a supported `0.1.0` release asset.

After the draft is created, run **Signed Windows Release Smoke** against the same tag. That workflow downloads the draft assets on a fresh hosted runner and independently repeats signature, MSI-payload, and Windows lifecycle checks. Publishing remains a manual action after the smoke workflow passes.

Tauri updater keys (`TAURI_SIGNING_PRIVATE_KEY`) are a different mechanism from Windows Authenticode. Pi GUI does not currently ship the updater plugin, so updater keys must not be presented as platform-signing completion.
