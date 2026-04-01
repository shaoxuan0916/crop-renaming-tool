# AGENTS.md

## Scope
- Applies to `apps/web` and anything below it.

## Stack
- React 19 + TypeScript + Vite.
- Browser-local persistence uses `localStorage` and IndexedDB via `idb`.

## Code Map
- `src/App.tsx`: main UI state and user interactions.
- `src/lib/workflow.ts`: file import, WebP conversion, naming, preview, and download workflow.
- `src/lib/storage.ts`: session, preset, and queue persistence in `localStorage`.
- `src/lib/db.ts`: IndexedDB blob storage.
- `src/lib/types.ts`: shared app types.

## Implementation Rules
- Keep browser persistence behavior explicit. When changing queue/session shape, update storage defaults and recovery paths together.
- Prefer fixing issues in workflow and storage code instead of pushing more complexity into the component.
- Treat preview URLs and blob lifecycle carefully to avoid leaks or accidental revocation.
- Preserve the browser-local product constraint: no server calls, no external upload flow.

## Validation
- Build with `pnpm build` from `apps/web`.
- Run locally with `pnpm dev` from `apps/web`.
- For behavior changes, verify at least these flows:
- import images
- finalize and rename items
- retry conversion
- download a single item
- download all ready items as zip
- reload the page with an existing queue

## UI Notes
- Preserve the current single-page layout and light visual direction unless a redesign is requested.
- Keep desktop and narrow-screen behavior coherent; the layout already collapses below `1080px`.
