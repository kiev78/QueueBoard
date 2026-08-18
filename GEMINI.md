# QueueBoard - Agent Instructions & Architecture Guide

QueueBoard is an Angular (v21 preview) single-page application with Server-Side Rendering (SSR) support via `@angular/ssr` and Express. It provides a Trello-style Kanban board for organizing YouTube playlists and videos with drag-and-drop, custom/alphabetical/recent sorting, ranking, search filtering, and playlist migration (YouTube <-> Spotify).

---

## 1. Project Layout & Workspace Structure

- **Repository Root**: `c:\dev\QueueBoard`
- **Application Directory**: `queueboard/` — **all npm/Angular commands must be executed in `queueboard/`**
- **Configuration Files**:
  - `queueboard/angular.json` — Angular CLI build configuration
  - `queueboard/tsconfig.app.json`, `queueboard/tsconfig.spec.json`, `queueboard/tsconfig.json`
  - `queueboard/src/env/environment.ts` — API client configuration (Google Client ID, Google API Key)
- **Entry Points**:
  - Browser bootstrap: `queueboard/src/main.ts`
  - SSR bootstrap: `queueboard/src/main.server.ts` & `queueboard/src/server.ts` (Express engine)
  - Routes: `queueboard/src/app/app.routes.ts` (`/` -> `OrganizerComponent`, `/transfer` -> `TransferComponent`)

---

## 2. Core Architecture & Patterns

### 2.1. Standalone Components & Signals
- All components are Angular standalone components using modern control flow (`@if`, `@for`, `@else`).
- State is managed via Angular signals (`signal()`, `computed()`).
- When updating signals containing arrays or objects, create shallow copies before calling `.set()` or `.update()`:
  ```typescript
  const updated = [...this.playlists()];
  updated[idx] = { ...updated[idx], videos: newVideos };
  this.playlists.set(updated);
  ```

### 2.2. SSR & Browser Globals Safety
- Always guard browser-only APIs (`window`, `document`, `localStorage`, `sessionStorage`, `IndexedDB`, DOM queries) with `isPlatformBrowser(this.platformId)` or `typeof window !== 'undefined'`.

### 2.3. Multi-Tier Storage Architecture
- Handled by `StorageService` (`src/app/services/StorageService.ts`), which delegates to `IndexedDbStorageService` with fallback to `LocalStorageService`.
- Use `this.storage.getPlaylists()` and `this.storage.savePlaylists(this.playlists())` for state persistence.
- Standard local storage keys are defined in `LOCAL_STORAGE_KEYS` (`src/app/services/local-storage-keys.ts`).

---

## 3. Services & Subsystems

| Service | File | Purpose |
| :--- | :--- | :--- |
| `PlaylistService` | `src/app/services/playlist.service.ts` | Fetching, merging, creating playlists and fetching video items from YouTube. |
| `SortService` | `src/app/services/sort.service.ts` | Playlist sorting (`CUSTOM`, `ALPHABETICAL`, `RECENT` by `lastUpdated`), custom sort order persistence and migration. |
| `StorageService` | `src/app/services/StorageService.ts` | Main storage facade for saving/loading playlists across IndexedDB and LocalStorage. |
| `YoutubeApiService` | `src/app/services/youtube-api.service.ts` | Loads Google GSI & gapi scripts dynamically, handles OAuth token lifecycle and YouTube Data API v3 calls. |
| `SpotifyApiService` | `src/app/services/spotify-api.service.ts` | Handles Spotify OAuth 2.0 PKCE auth flow and playlist/track retrieval for `/transfer`. |
| `PlayerManagerService` | `src/app/services/PlayerManagerService.ts` | Manages embedded YouTube player states (open, minimize, restore, play/pause). |
| `ThemeService` | `src/app/services/theme.service.ts` | Dark mode and light mode toggling (`body.dark-mode`), system theme preference detection. |
| `ToastService` | `src/app/services/toast.service.ts` | Displays non-blocking UI notifications and error messages. |
| `ErrorHandlerService` | `src/app/services/ErrorHandlerService.ts` | Normalizes errors from YouTube API, auth, and network calls. |

---

## 4. Board & Playlist Ranking Mechanics

### 4.1. True Master List Ranking
- The playlist board displays each playlist's true 1-based rank in the **master unfiltered list**, computed via:
  - `sortedFullPlaylists`: Computed signal applying the active sort order or custom order to all valid playlists.
  - `playlistRankMap`: Map of `playlistId -> 1-based index` in `sortedFullPlaylists`.
  - `getPlaylistRank(playlistId)`: Helper for template access.
  - `filteredPlaylists`: Computed signal filtering `sortedFullPlaylists` against search terms while preserving true master ranks.

### 4.2. Manual Rank Input & Reordering
- In each playlist column header (`.playlist-rank-input`):
  - Users can view and manually change the playlist's rank.
  - Entering a new rank `targetRank` reorders `sortedFullPlaylists`, shifts intermediate items (e.g. moving rank 45 to 1 shifts rank 12 to 13), saves the updated custom order (`sortService.saveCustomSortOrder`), sets sort mode to `CUSTOM`, persists state, and smoothly scrolls to the target column (`scrollToPlaylist`).
  - Inputs suppress CDK drag propagation using `(mousedown)="$event.stopPropagation()"` and `(pointerdown)="$event.stopPropagation()"`.

### 4.3. Drag & Drop
- Uses Angular CDK (`cdkDropListGroup`, `cdkDropList`, `cdkDrag`).
- Column drops (`dropPlaylist`) map visible indices to master list indices and reorder the master playlist array.
- Video drops (`drop`) support reordering within the same playlist or moving across playlists with YouTube sync (`syncMove`).

---

## 5. Styling & Theme System

- Color tokens defined in `src/app/organizer/_variables.scss` and `src/styles.scss`:
  - `--color-primary`, `--color-surface`, `--color-surface-alt`, `--color-background`, `--color-border`, `--color-text`, `--color-text-muted`.
  - Supports automatic system dark mode (`@media (prefers-color-scheme: dark)`) and manual toggle via `body.dark-mode` / `body:not(.dark-mode)`.
- Use text truncation (`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) for headers and titles to ensure resilience in responsive column layouts.

---

## 6. Development Workflow & Commands

> Always execute build and test commands inside the `queueboard/` subdirectory.

```bash
# Navigate to app directory
cd queueboard

# Start development server
npm start          # Runs ng serve on http://localhost:4200

# Build SPA + SSR bundles
npm run build      # Or: npx ng build

# Run SSR Server
npm run serve:ssr:queueboard

# Run tests
npm test
```

---

## 7. Guidelines for AI Agents

1. **Keep edits minimal and targeted**: Modify files under `queueboard/src/app/` using precise replacements.
2. **Preserve External Script Loading**: YouTube API scripts (`apis.google.com/js/api.js`, `accounts.google.com/gsi/client`) are dynamically loaded at runtime in `YoutubeApiService`; do not convert them to static npm imports.
3. **Never Commit Secrets**: Do not commit real Google/Spotify API keys into `environment.ts` or git.
4. **Maintain Master List Indexing**: Any new playlist reordering, jumping, or batch sorting feature must preserve master list rank computation and persistence through `SortService` and `StorageService`.
5. **Always Verify Builds**: Run `npx.cmd ng build` in `queueboard/` to verify TypeScript, templates, and SCSS compilation before completing tasks.
