# Crop Renamer Monorepo

This monorepo contains multiple app tracks for the same workflow:

- `apps/mac`: the current working macOS SwiftUI app
- `apps/windows`: the new Windows-focused Tauri + React scaffold
- `apps/web`: a browser-only version that keeps images in-browser and exports ZIP downloads

## Goal

All app variants implement the same naming workflow:

- drop cropped images
- convert each image to `.webp`
- apply a batch first token plus freeform suffix
- keep finalized assets local to the app runtime

Platform-specific output:

- macOS and Windows desktop variants save finalized files into a chosen destination folder
- the web variant keeps finalized files in browser-local storage and exports them as ZIP downloads

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
  web/
    package.json
    src/
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

### Web app

```bash
pnpm install:web
pnpm dev:web
pnpm build:web
```
