# Permissions and Security Notes

Pi Desktop uses Tauri 2 capabilities to function as a local coding-agent host.

Current capability file:
- `src-tauri/capabilities/default.json`

## Why these permissions exist

The app needs to:
- launch and communicate with Pi runtime processes
- read Pi session files through dedicated Rust commands
- list, index, read, and save files inside the explicitly selected workspace
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

## Recommendation for enterprise/restricted environments

- fork and tailor `default.json`
- keep project access behind the workspace-scoped Rust commands
- review shell execute allowlists
- validate package installation/update policies
