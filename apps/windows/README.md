# Crop Renamer Windows

Windows-focused desktop scaffold for the crop renaming workflow.

## Stack

- Tauri v2
- React 19
- TypeScript 6
- Vite 8
- Rust backend commands for file processing

## Install

```bash
cd /Users/shaoxuan/Documents/Playground/apps/windows
pnpm install
```

## Web UI only

```bash
pnpm dev
pnpm build
```

## Desktop app

```bash
pnpm tauri:dev
pnpm tauri:build
```

## Binary dependency

For the Rust backend to generate `.webp` files, ship `cwebp.exe` in:

`resources/bin/windows/cwebp.exe`

If that file is absent, the backend falls back to searching `PATH`.
