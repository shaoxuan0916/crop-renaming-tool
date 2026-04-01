# Crop Renamer Windows Tauri Backend

Rust + Tauri backend for the Windows desktop app.

## Contents

- `src/main.rs`: Tauri entry point
- `src/lib.rs`: exported Tauri library
- `src/workflow.rs`: desktop workflow logic
- `tauri.conf.json`: app window, build, and bundle configuration
- `Cargo.toml`: Rust package manifest

## Local run

From `apps/windows`:

```bash
pnpm tauri:dev
```

## Build

From `apps/windows`:

```bash
pnpm tauri:build
```

## Notes

- the frontend dev server for Tauri is configured through `beforeDevCommand`
- the desktop bundle is configured to include `../resources/bin/windows/cwebp.exe`
