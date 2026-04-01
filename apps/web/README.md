# Crop Renamer Web

Browser-only version of the crop renaming workflow.

## What it does

- imports cropped images by drag-drop or file picker
- converts each image to `.webp` in the browser
- keeps queue data and image blobs locally in browser storage
- applies a batch first token plus freeform suffix
- downloads all finalized files as a ZIP into the browser's default downloads flow

## Run

```bash
cd /Users/your-username/Documents/crop-renaming-tool/apps/web
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

## Notes

- no server or object storage is used
- images are persisted in IndexedDB in the browser
- the browser version cannot write directly into an arbitrary local folder, so export is done as a ZIP download
