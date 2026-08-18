# Agent Instructions for QueueBoard

This document provides comprehensive architecture guidelines, conventions, and instructions for AI agents (including Jules, Gemini, and coding assistants) interacting with and contributing to the QueueBoard codebase.

---

## 1. Project Overview & Workspace Structure

QueueBoard is an Angular (v21 preview) single-page application with Server-Side Rendering (SSR) support via `@angular/ssr` and Express. It provides a Trello-style Kanban board for organizing YouTube playlists and videos with drag-and-drop, custom/alphabetical/recent sorting, ranking, search filtering, and playlist migration (YouTube <-> Spotify).

- **Repository Root**: `c:\dev\QueueBoard`
- **Application Directory**: `queueboard/` — **all npm and Angular CLI commands must be executed within `queueboard/`**
- **Configuration Files**:
  - `queueboard/angular.json` — Angular CLI build configuration
  - `queueboard/tsconfig.app.json`, `queueboard/tsconfig.spec.json`, `queueboard/tsconfig.json`
  - `queueboard/src/env/environment.ts` — API client configuration (Google Client ID, Google API Key)
- **Entry Points**:
  - Browser bootstrap: `queueboard/src/main.ts`
  - SSR bootstrap: `queueboard/src/main.server.ts` & `queueboard/src/server.ts` (Express handler)
  - Routes: `queueboard/src/app/app.routes.ts` (`/` -> `OrganizerComponent`, `/transfer` -> `TransferComponent`)

---

## 2. Getting Started & Development Commands

> Always run commands from the `queueboard/` subdirectory: `cd queueboard`

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Run Development Server:**
   - **Client-side only (SPA):**
     ```bash
     npm start          # Runs ng serve at http://localhost:4200/
     # or: npm run start:dev
     ```
   - **SSR Server:**
     ```bash
     npm run build
     npm run serve:ssr:queueboard   # Runs node dist/queueboard/server/server.mjs
     ```

3. **Building the Project:**
   ```bash
   npm run build      # Or: npx.cmd ng build
   ```

4. **Testing (Jest):**
   ```bash
   npm test               # Run all unit tests
   npm run test:watch     # Run tests in watch mode
   npm run test:ci        # CI mode with coverage and memory checks
   npm run test:coverage  # Generate coverage report
   ```

---

## 3. Core Technologies & Architectural Patterns

### 3.1. Standalone Components & Signal Reactivity
- All components are Angular standalone components using modern control flow (`@if`, `@for`, `@else`).
- State is managed via Angular signals (`signal()`, `computed()`).
- **Signal Updates**: Always create shallow copies of arrays/objects before mutating and calling `.set()` or `.update()`:
  ```typescript
  const updated = [...this.playlists()];
  updated[idx] = { ...updated[idx], videos: newVideos };
  this.playlists.set(updated);
  ```

### 3.2. Server-Side Rendering (SSR) & Browser Globals Safety
- Always guard browser-only APIs (`window`, `document`, `localStorage`, `sessionStorage`, `IndexedDB`, DOM queries) with `isPlatformBrowser(this.platformId)` or `typeof window !== 'undefined'` to avoid runtime errors during SSR prerendering.

### 3.3. Multi-Tier Storage Architecture
- Handled by `StorageService` (`src/app/services/StorageService.ts`), delegating to `IndexedDbStorageService` with fallback to `LocalStorageService`.
- Use `this.storage.getPlaylists()` and `this.storage.savePlaylists(this.playlists())` for state persistence.
- Standard storage keys are centralized in `LOCAL_STORAGE_KEYS` (`src/app/services/local-storage-keys.ts`).

---

## 4. Key Services & Subsystems

| Service | File | Purpose |
| :--- | :--- | :--- |
| `PlaylistService` | `src/app/services/playlist.service.ts` | Fetching, merging, creating playlists and fetching video items from YouTube. |
| `SortService` | `src/app/services/sort.service.ts` | Playlist sorting (`CUSTOM`, `ALPHABETICAL`, `RECENT` by `lastUpdated`), custom sort order persistence and migration. |
| `StorageService` | `src/app/services/StorageService.ts` | Main storage facade for saving/loading playlists across IndexedDB and LocalStorage. |
| `YoutubeApiService` | `src/app/services/youtube-api.service.ts` | Dynamic runtime loading of Google scripts (`apis.google.com/js/api.js`, `accounts.google.com/gsi/client`), token lifecycle, and YouTube Data API calls. |
| `SpotifyApiService` | `src/app/services/spotify-api.service.ts` | Spotify OAuth 2.0 PKCE auth flow and track/playlist management for `/transfer`. |
| `PlayerManagerService` | `src/app/services/PlayerManagerService.ts` | YouTube embedded player lifecycle (open, minimize, restore, play/pause). |
| `ThemeService` | `src/app/services/theme.service.ts` | Light/dark theme toggling (`body.dark-mode`), automatic system preference detection. |
| `ToastService` | `src/app/services/toast.service.ts` | Non-blocking UI toast notifications. |
| `ErrorHandlerService` | `src/app/services/ErrorHandlerService.ts` | Error normalization and severity handling for API and network calls. |

---

## 5. Board & Playlist Ranking Mechanics

### 5.1. True Master List Ranking
- Ranks displayed on playlist cards always reflect the playlist's 1-based index in the **master unfiltered list**, computed via:
  - `sortedFullPlaylists`: Computed signal applying active sort order or custom order to all valid playlists.
  - `playlistRankMap`: Map of `playlistId -> 1-based index` in `sortedFullPlaylists`.
  - `getPlaylistRank(playlistId)`: Helper for template access.
  - `filteredPlaylists`: Computed signal filtering `sortedFullPlaylists` against search terms while preserving true master ranks.

### 5.2. Manual Rank Input & Reordering
- In each playlist column header (`.playlist-rank-input`):
  - Users can view and change the playlist's rank directly.
  - Changing rank reorders `sortedFullPlaylists`, shifts intermediate items (e.g. moving rank 45 to 1 shifts rank 12 to 13), saves custom sort order, sets mode to `CUSTOM`, persists state, and smoothly scrolls to the target column (`scrollToPlaylist`).
  - Inputs suppress CDK drag propagation using `(mousedown)="$event.stopPropagation()"` and `(pointerdown)="$event.stopPropagation()"`.

### 5.3. Drag & Drop
- Uses Angular CDK (`cdkDropListGroup`, `cdkDropList`, `cdkDrag`).
- Column drops (`dropPlaylist`) map visible items to master indices and reorder the full playlist list.
- Video drops (`drop`) support reordering within the playlist or cross-playlist transfer with YouTube API sync (`syncMove`).

---

## 6. Styling & Theme System

- Color tokens defined in `src/app/organizer/_variables.scss` and `src/styles.scss`:
  - `--color-primary`, `--color-surface`, `--color-surface-alt`, `--color-background`, `--color-border`, `--color-text`, `--color-text-muted`.
  - Supports automatic system dark mode (`@media (prefers-color-scheme: dark)`) and manual toggle via `body.dark-mode` / `body:not(.dark-mode)`.
- Use text truncation (`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) for headers and titles to ensure resilience in responsive column layouts.

---

## 7. Coding Style & Conventions

- **Prettier Settings**:
  - **Line Width**: Max 135 characters (default printWidth 100 for standard code).
  - **Quotes**: Single quotes (`'`) for TypeScript strings.
  - **Brackets**: Place brackets on the same line.
  - **HTML Attributes**: Clean attribute formatting (single attribute per line when multiline).
- **TypeScript**:
  - Strict mode enabled (`tsconfig.json`).
  - Strong typing with interfaces/types from `youtube-api.types.ts`, `sort.types.ts`, `playlist.service.ts`.

---

## 8. Guidelines for AI Agents

1. **Keep Edits Minimal and Targeted**: Modify standalone components under `queueboard/src/app/` using precise replacements.
2. **Preserve External Script Loading**: YouTube API scripts (`apis.google.com/js/api.js`, `accounts.google.com/gsi/client`) are dynamically loaded at runtime in `YoutubeApiService`; do not convert them to static npm imports.
3. **Never Commit Secrets**: Do not commit real Google/Spotify API keys into `environment.ts` or git.
4. **Maintain Master List Indexing**: Any playlist reordering or ranking feature must preserve master list rank computation and persistence through `SortService` and `StorageService`.
5. **Always Verify Builds**: Run `npx.cmd ng build` in `queueboard/` to verify TypeScript, templates, and SCSS compilation before completing tasks.