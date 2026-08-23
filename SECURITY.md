# Security Policy

## Supported versions

Pi GUI `0.1.0` is an unpublished candidate. There is no supported public release line yet, and locally generated unsigned installers are not public release artifacts.

This section will list supported versions after the independent repository, signing, and clean-machine release gates are operational.

## Reporting a vulnerability

Do not open a public issue containing vulnerability details, credentials, private prompts, session files, or reproduction data from a private repository.

Before the first public release, the independent Pi GUI repository must enable GitHub private vulnerability reporting. Use that private channel once it is available. Pi GUI reports must not be sent to the Gustav or DLYZZT maintainers unless the issue is independently reproduced in their project.

A useful report includes:

- affected Pi GUI version or commit;
- operating system and Pi runtime source/version;
- minimal reproduction steps and impact;
- redacted logs or screenshots;
- suggested remediation, if known.

The project currently has no public security intake address. Publishing remains blocked until a private reporting channel is configured.

## Security boundary

Pi GUI is a local development runtime host and requires filesystem and process permissions. The renderer receives narrow Tauri commands rather than arbitrary shell, Git, runtime executable, environment, or filesystem access.

Provider credentials remain owned by Pi. React receives provider/source/type metadata, not secret values. Lifecycle logs exclude prompts, model output, credentials, and environment variables.

Review `docs/PERMISSIONS.md` and `src-tauri/capabilities/default.json` before production, enterprise, or restricted-environment deployment.
