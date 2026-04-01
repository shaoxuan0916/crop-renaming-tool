# Architecture

## Shared product behavior

The application family is a local workflow for processing cropped images into final `.webp` assets with a controlled naming scheme.

Core behaviors:

- first token is fixed for the batch
- suffix is freeform per item
- final filename is `firstToken.webp` or `firstToken_suffix.webp`
- invalid filename characters are sanitized
- filename collisions are blocked
- each platform keeps assets local and only finalizes after a successful `.webp` conversion

Platform output differences:

- desktop variants write finalized assets into a chosen destination folder
- the browser variant stores queue data locally in the browser and exports finalized files as ZIP downloads

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

## web app

The web app is implemented as a browser-only React app under `apps/web`.

Frontend responsibilities:

- render the batch/session UI
- accept drag-drop and file picker image imports
- convert source images to `.webp` in-browser
- persist presets, queue metadata, and image blobs locally in the browser
- export finalized assets as a ZIP download

## Shared data model

Shared conceptual types:

- `BatchSession`
- `QueueItem`
- `SessionLogEntry`
- `RenameUndoAction`

These types are already present in the mac app and mirrored in the Windows scaffold.
