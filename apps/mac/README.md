# Crop Renamer

A local macOS SwiftUI app for:

- dropping cropped images
- converting each image to `.webp`
- applying a batch first token plus freeform suffix
- moving the final file into a chosen destination folder

## Run

```bash
cd /Users/shaoxuan/Documents/Playground/apps/mac
swift run
```

## Dependency

The app uses `cwebp` for WebP conversion.

```bash
brew install webp
```

## Workflow

1. Choose the destination folder.
2. Enter the batch first token.
3. Drop one or more cropped images into the drop zone.
4. Select an item, type the suffix, then press `Enter` or click `Finalize`.
5. Optionally edit a ready item's suffix and click `Rename`.

## Notes

- Final outputs are always `.webp`.
- The original dropped file is moved to a temporary backup before the final `.webp` file replaces it.
- `Cmd+Z` undoes the last finalized rename and restores the original source file when possible.
- Session state is logged to `crop-session-log.json` in the destination folder.
