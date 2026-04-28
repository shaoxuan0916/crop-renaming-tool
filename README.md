# Crop Renaming Tool

Browser-local crop renaming workflow built with React, TypeScript, and Vite.

## What the app does

The app is built around one local-first job:

- import cropped images
- convert outputs to `.webp`
- apply a shared first token plus per-file suffix
- review a queue before export
- keep files in browser storage
- export ready items as a zip download

## Repository layout

```text
apps/
  web/
docs/
```

## Prerequisites

- Node.js 22+
- `pnpm` 10+

## Root commands

```bash
pnpm install
pnpm dev:web
pnpm build:web
```

## App guides

- [Web app](./apps/web/README.md)
- [Docs index](./docs/README.md)

## Current status

- the browser app is the only active app target in this repository
- queue metadata is stored in `localStorage`
- image blobs are stored in IndexedDB
- finalized assets are downloaded from the browser as individual files or zip archives
