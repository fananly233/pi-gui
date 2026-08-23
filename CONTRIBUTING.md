# Contributing to Pi GUI

Thanks for helping improve Pi GUI.

Pi GUI is an independently modified derivative of Gustav Pi Desktop with selected DLYZZT React material. Keep the attribution in `README.md`, `THIRD_PARTY_NOTICES.md`, and release notes when changing distribution or repository metadata.

## Repository status

The `0.1.0` candidate does not yet have an independent public `origin`. Do not clone or file Pi GUI issues against either donor repository. Once the independent repository is connected, replace the placeholder below with its URL:

```powershell
git clone <Pi GUI repository URL>
cd pi-gui
npm ci
npm run tauri dev
```

Until a public branch policy is published, create a focused feature or fix branch from the current Pi GUI integration branch. Do not merge the Electron archive into the Tauri history.

## Commit identity and private data

Use a public GitHub identity and a GitHub noreply address for commits:

```powershell
git config --local user.name "<public GitHub name>"
git config --local user.email "<GitHub noreply address>"
```

Never commit:

- `.env`, provider credentials, Pi `auth.json`, cookies, tokens, or private keys;
- local Pi/Codex state, application data, runtime downloads, session exports, or raw diagnostic logs;
- machine-specific home paths or local research/orchestration prompts;
- screenshots or fixtures containing prompts, model output, repository secrets, or personal paths.

Run `npm run check:publish` before the first public push and before release. The command reports only categories and paths; it does not print suspected secret values.

## Development rules

- Keep changes small and scoped.
- Preserve typed Tauri commands as the native trust boundary.
- Do not add an Electron host, general renderer filesystem access, arbitrary shell/Git arguments, or a second Pi policy layer.
- Keep interactive Pi-only behavior in Pi when RPC does not expose a safe equivalent.
- Distinguish deterministic tests, real-Pi gates, local bundle smoke checks, and clean-machine installer evidence.

## Validation

Run the gates relevant to the change:

```powershell
npm run check
npm test
npm run build:frontend
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
npm audit
```

For release-facing changes, also run:

```powershell
npm run check:release
npm run check:publish
git diff --check
```

Real integration gates are listed in `README.md`. State exactly which ones ran; do not describe a compile, local launch, or extracted EXE smoke test as clean-machine verification.

## Pull requests

A pull request should explain what changed, why it belongs in Pi GUI core, its security/permission impact, and exact verification performed. Include redacted screenshots for visible UI changes and update the affected documentation in the same change.

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
