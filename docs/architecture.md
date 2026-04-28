# Architecture

## Product Behavior

The application is a browser-local workflow for processing cropped images into final `.webp` assets with a controlled naming scheme.

Core behaviors:

- first token is fixed for the batch
- suffix is freeform per item
- final filename is `firstToken.webp` or `firstToken_suffix.webp`
- invalid filename characters are sanitized
- filename collisions are blocked
- imported assets stay local to the browser
- finalization only happens after a successful `.webp` conversion
- ready files can be downloaded individually or together as a ZIP archive

## Web App

The web app is implemented as a browser-only React app under `apps/web`.

Frontend responsibilities:

- render the batch/session UI
- accept drag-drop and file picker image imports
- convert source images to `.webp` in-browser
- persist presets, queue metadata, and image blobs locally in the browser
- export finalized assets as a ZIP download

## Data Model

Core types live in `apps/web/src/lib/types.ts`:

- `BatchSession`
- `QueueItem`
- `SessionLogEntry`
- `RenameUndoAction`
