This repository is an Angular (v21 preview) single-page application with optional server-side rendering (SSR) using @angular/ssr and an Express server.

Be concise and actionable: suggest edits as minimal, targeted patches. Prefer changes to files under `queueboard/src` unless the task is global (build scripts, package.json, CI).

Key facts you should know immediately
- Project root for the app: `queueboard/`.
- Build system: Angular CLI / `@angular/build` with SSR support. Core configs: `queueboard/angular.json`, `queueboard/tsconfig.*.json`.
- Dev server: `npm start` runs `ng serve` (see `queueboard/package.json`). For SSR server run target: `npm run serve:ssr:queueboard` which expects a built `dist/queueboard/server/server.mjs`.
- Source entry points:
  - Browser bootstrap: `queueboard/src/main.ts`
  - Server bootstrap (SSR): `queueboard/src/main.server.ts` and `queueboard/src/server.ts` (Express request handler and server)
- Routes: top-level routes are in `queueboard/src/app/app.routes.ts` and lazy-load the `OrganizerComponent` from `queueboard/src/app/organizer/organizer.component.ts`.

Patterns and conventions (code-level)
- Standalone components and signals: components are written as standalone (see `OrganizerComponent`) and use Angular's signal API for reactive state (e.g. `playlists = signal<...>([])`). When modifying state prefer creating shallow copies before calling `set()` (the code relies on copying arrays then calling `this.playlists.set(curr)`).
- Client-only globals: DOM APIs, `localStorage` and `sessionStorage` are used for persistence; guard edits with `if (typeof window === 'undefined')` when touching these from server/SSR code.
- YouTube integration: `YoutubeApiService` (in `src/app/services/youtube-api.service.ts`):
  - Expects `environment.googleClientId` and `environment.googleApiKey` set in `queueboard/src/env/environment.ts` (or prod file). Throwing/informative errors are used when credentials are missing; preserve that behavior.
  - Loads remote scripts (`apis.google.com/js/api.js` and `accounts.google.com/gsi/client`) at runtime — do not attempt to import these as synchronous packages.
- Drag & drop: uses CDK DragDrop module rather than complex state libraries; persistence of order is handled by `saveState()` writing to `localStorage`.

Builds / dev workflow (practical commands)
- Install: from repository root run `cd queueboard; npm install`.
- Dev SPA (no SSR): `npm start` (runs `ng serve`). Useful when iterating on UI and component logic.
- Build (browser + server bundles + SSR): use `ng build` from `queueboard/` (it is configured to emit browser + server artifacts per `angular.json`). After `ng build` you can run the SSR server with the provided script `npm run serve:ssr:queueboard` which executes `node dist/queueboard/server/server.mjs`.
- Tests: `npm test` runs Karma. There are currently no tests added beyond scaffolding; if you add tests mimic existing tsconfig and karma config patterns.

Code change guidelines for AI
- Small UI changes: edit standalone components under `queueboard/src/app/*`. Update templates (`*.html`) and styles (`*.scss`) alongside TypeScript component logic.
- State changes: follow the established pattern — obtain a copy, mutate the copy, then call `.set(copy)` on the signal. Example: see `connectYouTube()` and playlist merge code in `organizer.component.ts`.
- Server/SSR changes: be careful with DOM or window usage. `server.ts` exports `reqHandler` for hosting and guards starting the Express server with `isMainModule(import.meta.url)`.
- External secrets / keys: `environment.ts` currently contains example Google API keys. Do not hardcode new secrets into this file in PRs. If the task requires credentials, document the env var or create a local `environment.local.ts` and update `.gitignore` — but ask before committing secrets.

Integration points and external services
- Google YouTube Data API v3 via the browser gapi client and Google Identity Services (GSI). See `YoutubeApiService` for discovery doc, scope (`youtube.readonly`) and expected flows (token storage in sessionStorage with `queueboard_gapi_token`).
- Optional hosting: server code in `server.ts` is a standard Express app using `@angular/ssr/node` engine. Production deployment expects built `dist/queueboard` with `browser` and `server` artifacts.

Files to reference when editing or diagnosing
- Routing and lazy-loading: `queueboard/src/app/app.routes.ts`
- App config / providers: `queueboard/src/app/app.config.ts` and `queueboard/src/app/app.config.server.ts`
- Organizer UI and main app logic: `queueboard/src/app/organizer/organizer.component.ts`, `organizer.component.html`, `organizer.component.scss`
- YouTube integration: `queueboard/src/app/services/youtube-api.service.ts` and `queueboard/src/env/environment.ts`
- Dev server and SSR entry points: `queueboard/src/main.ts`, `queueboard/src/main.server.ts`, `queueboard/src/server.ts`
- Angular CLI config: `queueboard/angular.json` and `queueboard/package.json`

Examples to copy from (concrete snippets)
- Signal update (preserve copying behavior):
  const curr = [...this.playlists()];
  curr[idx] = { ...curr[idx], videos: mapped };
  this.playlists.set(curr);

- Guard window/localStorage for SSR-safe code:
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

What not to change unless requested
- Do not replace the runtime loading of Google scripts with a static import.
- Do not commit API keys or client ids. Use existing `environment.ts` as an example only.

If anything is unclear or you need more repo-specific details (missing scripts, CI, or local env patterns), ask for permission to inspect more files or the user's intended deployment target.

Please review this guidance and tell me which section you want expanded or turned into tests/automation (for example, a small smoke test that runs `ng build` or a script that validates environment keys exist).
