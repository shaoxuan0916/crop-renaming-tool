# Crop Renamer macOS

Local SwiftUI app for the crop renaming workflow.

## What it does

- imports cropped images locally
- converts outputs to `.webp`
- applies a batch first token plus per-image suffix
- writes finalized files through the macOS app flow

## Requirements

- macOS 14+
- Swift 6.2 toolchain
- `cwebp` installed and available on `PATH`

Install `cwebp` with Homebrew:

```bash
brew install webp
```

## Run

From the repo root:

```bash
pnpm dev:mac
```

Or from this directory:

```bash
swift run
```

## Build

From the repo root:

```bash
pnpm build:mac
```

Or from this directory:

```bash
swift build
```

## Source layout

- `Sources/Playground/PlaygroundApp.swift`: app entry
- `Sources/Playground/ContentView.swift`: UI
- `Sources/Playground/AppViewModel.swift`: view model
- `Sources/Playground/FileWorkflowService.swift`: file workflow logic
- `Sources/Playground/Models.swift`: shared models
