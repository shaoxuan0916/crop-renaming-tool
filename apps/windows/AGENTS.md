# AGENTS.md

## Scope
- Applies to `apps/windows` and anything below it.

## Stack
- React 19 + TypeScript + Vite frontend.
- Tauri 2 shell and native bridge under `src-tauri`.

## Code Map
- `src/App.tsx`: main desktop UI.
- `src/lib/tauri.ts`: Tauri-specific integration points.
- `src/lib/storage.ts` and `src/lib/types.ts`: frontend state helpers and types.

## Implementation Rules
- Keep web-only assumptions out of the Windows app; prefer Tauri-aware file and dialog handling.
- When changing behavior that overlaps with the web app, compare patterns first but do not force shared abstractions unless duplication is clearly harmful.
- Avoid editing generated build artifacts in `dist`.

## Validation
- Build web assets with `pnpm build` from `apps/windows`.
- Use `pnpm tauri:dev` for end-to-end desktop validation when the task touches native integration.
