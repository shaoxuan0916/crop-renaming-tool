# Architecture

## Shared product behavior

The application is a local desktop workflow for processing cropped images into final `.webp` assets with a controlled naming scheme.

Core behaviors:

- destination folder is chosen once per batch
- first token is fixed for the batch
- suffix is freeform per item
- final filename is `firstToken.webp` or `firstToken_suffix.webp`
- invalid filename characters are sanitized
- filename collisions are blocked
- original file is only replaced after a successful `.webp` conversion
- undo restores the original file when possible
- session log is written to `crop-session-log.json` inside the destination folder

## mac app

The mac app is implemented in SwiftUI and AppKit under `apps/mac`.

Key files:

- `Sources/Playground/PlaygroundApp.swift`
- `Sources/Playground/AppViewModel.swift`
- `Sources/Playground/FileWorkflowService.swift`
- `Sources/Playground/ContentView.swift`

## windows app

The Windows app scaffold is implemented as Tauri v2 + React under `apps/windows`.

Frontend responsibilities:

- render the batch/session UI
- manage selected queue item
- persist presets and queue/session state locally
- subscribe to native drag-drop events
- call Rust commands for file operations

Rust responsibilities:

- convert source images to `.webp` using `cwebp`
- manage temp import, temp conversion, and backup paths
- finalize rename operations
- rename ready items
- undo finalized items
- export the session log

## Shared data model

Shared conceptual types:

- `BatchSession`
- `QueueItem`
- `SessionLogEntry`
- `RenameUndoAction`

These types are already present in the mac app and mirrored in the Windows scaffold.
