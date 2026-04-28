# AGENTS.md

## Scope
- Applies to the entire repository unless a deeper `AGENTS.md` overrides it.

## Repository Shape
Web-only workspace:

- `apps/web`: browser-based crop renaming workflow built with React, TypeScript, and Vite.

## Working Rules
- Reuse existing patterns inside `apps/web` before introducing abstractions.
- Keep changes scoped to the web app unless documentation or root scripts also need updates.
- Do not add production dependencies without clear need.
- Prefer small, reviewable edits and preserve the current architecture.

## Validation
Root scripts are thin wrappers around the web app commands:

- `pnpm build:web`
- `pnpm dev:web`

## File Placement
- Put browser-only storage and workflow logic under `apps/web/src/lib`.
- Put UI changes under `apps/web/src` unless a more specific existing location fits.

## Notes
- `apps/web/dist` is build output; do not hand-edit it.
- Add or update guidance in `apps/web/AGENTS.md` when instructions only apply to the web app.
