# AGENTS.md

## Scope
- Applies to `apps/mac` and anything below it.

## Stack
- Swift Package Manager project.
- App sources live under `Sources/Playground`.

## Code Map
- `Sources/Playground/PlaygroundApp.swift`: app entry point.
- `Sources/Playground/ContentView.swift`: top-level UI.
- `Sources/Playground/AppViewModel.swift`: view model state and actions.
- `Sources/Playground/FileWorkflowService.swift`: file workflow logic.
- `Sources/Playground/Models.swift`: app models.

## Implementation Rules
- Follow the existing SwiftUI structure rather than introducing extra layers without need.
- Keep file workflow logic out of view files when behavior changes are non-trivial.
- Do not edit `.build` artifacts.

## Validation
- Run `swift build` from `apps/mac` for compile validation.
- Use `swift run` from `apps/mac` when the task needs runtime verification.
