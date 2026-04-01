# Crop Renamer Web

Browser-local version of the crop renaming workflow.

## Current behavior

- drag and drop images anywhere in the app window, or use `Pick Files`
- keep the queue and converted blobs in browser storage
- preview the selected image without stretching it to fill the preview area
- apply a batch first token and per-image suffix
- export ready items as a zip download
- switch between light and dark mode
- use `Reset Session` to clear the batch session and the current queue together

## Stack

- React 19
- TypeScript 6
- Vite 8
- IndexedDB via `idb`
- `jszip` for zip export

## Run

From the repo root:

```bash
pnpm install
pnpm dev:web
```

Or from this directory:

```bash
pnpm install
pnpm dev
```

Open the exact URL printed by Vite. If `3000` is busy, Vite will move to the next free port.

## Build

```bash
pnpm build:web
```

Or from this directory:

```bash
pnpm build
```

## Notes

- no server or object storage is used
- queue metadata is stored in `localStorage`
- image blobs are stored in IndexedDB
- zip export is used because the browser cannot write directly into an arbitrary local folder
