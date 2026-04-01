# Crop Renamer Windows

Windows desktop track for the crop renaming workflow.

## Stack

- React 19
- TypeScript 6
- Vite 8
- Tauri 2
- Rust backend in `src-tauri`

## Working directories

- `src/`: React frontend
- `src-tauri/`: Rust + Tauri desktop backend
- `resources/bin/windows/`: bundled Windows binaries such as `cwebp.exe`

## Install

From the repo root:

```bash
pnpm install
```

Or from this directory:

```bash
pnpm install
```

## Frontend only

```bash
pnpm dev:windows:web
pnpm build:windows:web
```

From this directory:

```bash
pnpm dev
pnpm build
```

## Desktop app

```bash
pnpm dev:windows
pnpm build:windows
```

From this directory:

```bash
pnpm tauri:dev
pnpm tauri:build
```

See [src-tauri/README.md](./src-tauri/README.md) for backend details.

## Binary dependency

The Tauri backend expects `cwebp.exe` at:

`resources/bin/windows/cwebp.exe`

If that file is missing, the backend falls back to searching `PATH`.
