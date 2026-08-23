# Pi GUI Release TODO

Last updated: 2026-08-23.

This file tracks Pi GUI only. Gustav's historical v1 release and issue records remain available in Git history and are not Pi GUI release evidence.

## Completed preparation

- [x] Establish independent identity: `Pi GUI`, `pi-gui`, `com.pi.gui`, version `0.1.0`.
- [x] Keep Gustav MIT and DLYZZT Apache-2.0 attribution and modification notices.
- [x] Build local Windows NSIS/MSI candidates and record exact local-only evidence.
- [x] Add Windows clean-machine candidate and signed release-smoke workflows.
- [x] Refresh README, contribution, security, roadmap, package/theme, and release documentation to match the React/Tauri implementation.
- [x] Add ignore rules and a repeatable `npm run check:publish` privacy gate.
- [x] Keep six donor-only issue/development logs as ignored local files and remove them from the public Git index.
- [x] Confirm the local migration prompt is ignored and never entered Git history.
- [x] Confirm current `HEAD` history has no common key/token/private-key/credential-URL pattern hits.
- [x] With explicit maintainer approval, rewrite all 26 post-fork commits to the public GitHub identity and noreply author/committer email without changing source trees, subjects, dates, or topology.
- [x] Pass `npm run check:publish` across 143 tracked/non-ignored candidate files.
- [x] Diagnose the Windows PTY timeout without changing product code: the test can send CPR before cold PowerShell emits DSR and incorrectly assumes `cmd` needs no CPR; the final serial suite passed 23 tests with one network gate ignored.

## Blocking before first public push

- [x] Review the final staged diff and `git diff --check`.
- [x] Commit the documentation/privacy pass with the repository-local noreply identity (`df39d05`).
- [x] Create the independent public repository at `https://github.com/fananly233/pi-gui`.
- [x] Add its credential-free URL as `origin`; keep `gustav` and `dlyzzt` as donor remotes.
- [x] Push only the reviewed Pi GUI history to `origin/main`; do not push `archive/electron-mvp`, use `--all`, or use `--mirror`.
- [x] Replace placeholder repository references with the independent repository URL.
- [x] Enable and verify GitHub private vulnerability reporting through GitHub's dedicated API.
- [ ] Review the inherited `Pi DESK` icon/source filename against final Pi GUI branding.

## Blocking before public release

- [x] Harden the real-PTY test to wait for the observed DSR before replying, cover the Windows `cmd.exe` fallback, and prove both paths across six independent test-process runs.
- [x] Run **Windows Clean-Machine Candidate** from the independent repository against `582c662`.
- [x] Record successful install, launch, same-version update/reinstall, uninstall, shortcut and registry cleanup, and app-data preservation evidence.
- [ ] Configure Windows Authenticode signing for NSIS and MSI.
- [ ] Configure macOS signing and notarization.
- [ ] Build a draft release from the intended tag.
- [ ] Run **Signed Release Smoke** against the exact draft assets.
- [x] Record the candidate commit, workflow URLs, unsigned status, local hashes, hosted artifact, and known limitations in `docs/RELEASES.md`.
- [ ] Publish only after every required release criterion passes.

## First-release limitation

There is no earlier Pi GUI application identity to upgrade from. Version `0.1.0` can prove same-version update/reinstall; a true cross-version installer upgrade becomes mandatory for the next release.
