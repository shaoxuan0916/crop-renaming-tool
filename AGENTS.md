# AGENTS.md

## Scope
- Applies to the entire repository unless a deeper `AGENTS.md` overrides it.

## Repository Shape
- Monorepo with three app targets:
- `apps/web`: browser-based crop renaming workflow built with React, TypeScript, and Vite.
- `apps/windows`: Windows desktop app using React, TypeScript, Vite, and Tauri.
- `apps/mac`: macOS Swift app built with Swift Package Manager.

## Working Rules
- Reuse existing patterns inside the target app before introducing abstractions shared across apps.
- Keep changes scoped to the app being modified unless the task explicitly needs cross-app coordination.
- Do not add production dependencies without clear need.
- Prefer small, reviewable edits and preserve the current architecture.

## Validation
- Root scripts are thin wrappers around per-app commands.
- Web app:
- `pnpm build:web`
- `pnpm dev:web`
- Windows app:
- `pnpm build:windows:web`
- `pnpm dev:windows:web`
- `pnpm dev:windows`
- macOS app:
- `pnpm build:mac`
- `pnpm dev:mac`

## File Placement
- Put browser-only storage and workflow logic under `apps/web/src/lib`.
- Put Windows/Tauri-specific integrations under `apps/windows/src/lib`.
- Keep Swift source changes in `apps/mac/Sources/Playground`.

## Notes
- `apps/web/dist`, `apps/windows/dist`, and `apps/mac/.build` are build outputs; do not hand-edit them.
- If a task is web-only, add or update guidance in `apps/web/AGENTS.md` rather than expanding root instructions.
