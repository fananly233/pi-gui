# Security Policy

## Supported versions

Pi GUI `0.1.0` is an unpublished source-only candidate. The source repository is public, and locally or ephemerally generated applications/installers are not official release artifacts.

This section will list supported source tags after the first source-only Release is published. Pi GUI does not currently provide a supported binary distribution line.

## Reporting a vulnerability

Do not open a public issue containing vulnerability details, credentials, private prompts, session files, or reproduction data from a private repository.

The Pi GUI repository has enabled [GitHub private vulnerability reporting](https://github.com/fananly233/pi-gui/security/advisories/new). Use that channel for vulnerability details. Pi GUI reports must not be sent to the Gustav or DLYZZT maintainers unless the issue is independently reproduced in their project.

A useful report includes:

- affected Pi GUI version or commit;
- operating system and Pi runtime source/version;
- minimal reproduction steps and impact;
- redacted logs or screenshots;
- suggested remediation, if known.

If the private advisory form is unexpectedly unavailable, do not put sensitive details in a public issue; report the channel outage without including vulnerability details.

## Security boundary

Pi GUI is a local development runtime host and requires filesystem and process permissions. The renderer receives narrow Tauri commands rather than arbitrary shell, Git, runtime executable, environment, or filesystem access.

Provider credentials remain owned by Pi. React receives provider/source/type metadata, not secret values. Lifecycle logs exclude prompts, model output, credentials, and environment variables.

Review `docs/PERMISSIONS.md` and `src-tauri/capabilities/default.json` before production, enterprise, or restricted-environment deployment.
