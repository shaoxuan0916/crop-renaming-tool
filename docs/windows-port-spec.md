# Windows Port Spec

## Target stack

- Tauri v2
- React 19
- TypeScript 6
- Vite 8
- Rust backend commands for file operations

## Why this stack

- native desktop drag-drop support
- access to real file paths, which is required for replace-in-place behavior
- easy local persistence
- practical route to distribute one Windows executable later

## Required external binary

The Windows build should ship with `cwebp.exe`.

Expected bundled location in this scaffold:

`apps/windows/resources/bin/windows/cwebp.exe`

Fallback:

- if bundled binary is missing, search `PATH`

## Required command surface

Rust commands expected by the React app:

- `prepare_dropped_files(file_paths: string[]) -> QueueItem[]`
- `finalize_queue_item(session: BatchSession, item: QueueItem) -> { item, undoAction }`
- `rename_ready_item(session: BatchSession, item: QueueItem) -> QueueItem`
- `undo_last_rename(action: RenameUndoAction) -> void`
- `export_session_log(destination_folder: string, queue: QueueItem[]) -> void`

## Frontend persistence

Current scaffold uses browser storage for:

- presets
- last batch session
- queue snapshot

Recommended next upgrade:

- move these into a JSON file under the app config directory

## Drag and drop

Use Tauri window drag-drop events rather than browser-only drop APIs so the app receives real OS file paths on Windows.

## Validation behavior

Must preserve:

- block finalization if first token is empty
- block if destination folder is empty
- block if final filename already exists
- show backend error messages directly in the UI
- keep temp queue item in `error` state when finalization fails
