# Permissions and Security Notes

Pi GUI uses Tauri 2 capabilities to function as a local coding-agent host.

Current capability file:
- `src-tauri/capabilities/default.json`

## Why these permissions exist

The app needs to:
- launch and communicate with Pi runtime processes
- read Pi session files through dedicated Rust commands
- list, index, read, and save files inside the explicitly selected workspace
- host one interactive native PTY through dedicated lifecycle commands
- read Git status/diffs and manage guarded Git worktrees through typed commands
- open files/folders through native dialogs
- show native notifications
- manage window interactions

## Workspace file boundary

The WebView does not receive `fs:default` or recursive `$HOME` read/write permissions. Project files are exposed only through narrow Rust commands that:

- accept a selected workspace root plus a relative path
- canonicalize both the root and target before access
- reject absolute paths, `..` traversal, and symbolic-link escapes
- skip symbolic links and noisy generated directories in the explorer/index
- reject binary, non-UTF-8, and text files larger than 1 MiB
- require the original content when saving so an external edit is never overwritten silently

There is no general delete command and the Phase 5 editor only saves existing files.

## Terminal boundary

The Phase 6 terminal is not implemented with Tauri's WebView shell execution API. Four Rust commands own the PTY lifecycle:

- `terminal_start`
- `terminal_write`
- `terminal_resize`
- `terminal_stop`

The backend accepts an existing canonical workspace directory, chooses from a fixed platform shell list, clamps terminal dimensions, limits each input write to 64 KiB, and identifies every output/exit event by an opaque terminal ID. Output is carried as bytes so split UTF-8 reads do not corrupt xterm. Closing the panel or application stops the owned process tree.

The renderer has no `shell:allow-execute`, `shell:allow-spawn`, `shell:allow-stdin-write`, or `shell:allow-kill` capability. `shell:allow-open` remains only for user-initiated external links.

## Git and worktree boundary

The renderer cannot supply arbitrary Git arguments. The native bridge exposes only:

- repository status
- bounded staged/unstaged diff reads
- worktree listing
- adjacent worktree creation for a validated local branch name
- non-forced removal of an exact listed worktree

The selected workspace must be the canonical Git repository root. Diffs disable external diff drivers and text conversion and stop at 512 KiB. Worktree removal rejects the main/current worktree plus dirty, locked, prunable, or missing paths. Worktree creation still performs a normal local Git checkout, so repository-local Git configuration and checkout filters should be reviewed before use with an untrusted repository.

## Recommendation for enterprise/restricted environments

- fork and tailor `default.json`
- keep project access behind the workspace-scoped Rust commands
- keep terminal and Git access behind the typed Rust lifecycle commands
- review local Git configuration before creating a worktree from untrusted content
- validate package installation/update policies
