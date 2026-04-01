# Crop Renaming Tool

Monorepo for three local-first variants of the same crop renaming workflow:

- `apps/web`: browser-based React app
- `apps/windows`: React + Tauri Windows app
- `apps/mac`: SwiftUI macOS app

## What the apps do

Each variant is built around the same job:

- import cropped images
- convert outputs to `.webp`
- apply a shared first token plus per-file suffix
- review a queue before export

Platform differences:

- web keeps files in browser storage and exports a zip
- windows is intended to save through the desktop app flow
- mac saves through the native app flow

## Repository layout

```text
apps/
  mac/
  web/
  windows/
docs/
```

## Prerequisites

- Node.js 22+
- `pnpm` 10+
- macOS app: Xcode / Swift toolchain and `cwebp`
- Windows desktop app: Rust + Tauri prerequisites on a Windows-capable environment

## Root commands

```bash
pnpm dev:web
pnpm build:web

pnpm dev:windows:web
pnpm build:windows:web
pnpm dev:windows
pnpm build:windows

pnpm dev:mac
pnpm build:mac
```

## App guides

- [Web app](./apps/web/README.md)
- [Windows app](./apps/windows/README.md)
- [macOS app](./apps/mac/README.md)
- [Docs index](./docs/README.md)

## Current status

- the web app is the most complete cross-platform implementation in this repo
- the Windows app contains both the React UI and the Tauri backend scaffold
- the macOS app is a local SwiftUI implementation of the same workflow
