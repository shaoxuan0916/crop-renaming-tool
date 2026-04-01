# Crop Renamer Monorepo

This monorepo contains two desktop app tracks for the same workflow:

- `apps/mac`: the current working macOS SwiftUI app
- `apps/windows`: the new Windows-focused Tauri + React scaffold

## Goal

Both apps implement the same local workflow:

- drop cropped images
- convert each image to `.webp`
- apply a batch first token plus freeform suffix
- save the final file into a chosen destination folder

## Structure

```text
apps/
  mac/
    Package.swift
    Sources/
  windows/
    package.json
    src/
    src-tauri/
docs/
  architecture.md
  windows-port-spec.md
```

## Commands

### macOS app

```bash
pnpm build:mac
pnpm dev:mac
```

### Windows app scaffold

```bash
pnpm install:windows
pnpm dev:windows:web
pnpm build:windows:web
```

When building the real Windows desktop app, use:

```bash
pnpm dev:windows
pnpm build:windows
```

That requires a Windows-capable Rust + Tauri setup.
