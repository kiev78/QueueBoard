# QueueBoard - Project Information for GitHub Copilot

## Project Overview

QueueBoard is an Angular 21 (preview) single-page application that allows users to organize and manage their YouTube playlists in a Trello-style board interface. It features drag-and-drop functionality, video playback, search capabilities, and playlist sorting.

## Core Features

- **YouTube Integration**: Connects to YouTube Data API v3 via Google OAuth
- **Playlist Management**: View, organize, and sort playlists with drag-and-drop
- **Video Player**: Built-in YouTube video player with minimization support
- **Search**: Real-time search across playlists, videos, titles, descriptions, and tags
- **Sorting**: Multiple sort options (Last Updated, Date Added, Alphabetical) with persistence
- **Responsive Design**: Bootstrap-based UI with mobile support
- **State Persistence**: localStorage for playlist state, sort preferences, and manual ordering

## Project Structure

### Root Directory: `queueboard/`

```
queueboard/
├── src/
│   ├── main.ts                 # Browser bootstrap
│   ├── main.server.ts          # SSR bootstrap
│   ├── server.ts               # Express server for SSR
│   ├── index.html              # Main HTML template
│   ├── styles.scss             # Global styles (Bootstrap + custom)
│   └── app/
│       ├── app.ts              # Root component
│       ├── app.config.ts       # App configuration
│       ├── app.routes.ts       # Routing configuration
│       ├── organizer/          # Main feature module
│       └── services/           # Shared services
├── angular.json                # Angular CLI configuration
├── package.json               # Dependencies and scripts
└── tsconfig.*.json            # TypeScript configurations
```

### Key Components

#### Main Organizer (`src/app/organizer/`)

- **organizer.component.ts**: Main playlist board logic
- **organizer.component.html**: Trello-style board template
- **organizer.component.scss**: Board styling and responsive design
- **video-player/**: Full-screen video player component
- **minimized-videos/**: Minimized video stack component

#### Services (`src/app/services/`)

- **youtube-api.service.ts**: YouTube Data API integration
- **playlist.service.ts**: Playlist management and sorting logic
- **StorageService.ts**: Safe localStorage wrapper with SSR support
- **ErrorHandlerService.ts**: Centralized error handling
- **PlayerManagerService.ts**: YouTube player instance management
- **InputSanitizerService.ts**: Input validation and sanitization
- **PollingService.ts**: Background refresh functionality

### Data Models & Types

#### Core Interfaces

```typescript
// Playlist representation
interface PlaylistColumn {
  id: string;
  title: string;
  description?: string;
  color?: string;
  videos: VideoCard[];
  nextPageToken?: string; // Disabled for pagination
  sortId?: number; // Manual drag order
}

// Video representation
interface VideoCard {
  id: string; // YouTube video ID
  playlistItemId: string; // YouTube playlist item ID
  title: string;
  description?: string;
  duration?: string; // Formatted duration (mm:ss)
  thumbnail?: string;
  tags?: string[];
  channelTitle?: string;
  publishedAt?: string;
  youtubeUrl?: string;
  detailsVisible?: boolean; // UI state
  isMinimized?: boolean; // Player state
  isPlaying?: boolean; // Player state
  resumeTime?: number; // Player position
}

// Sort management
enum PlaylistSortOrder {
  LAST_UPDATED = "last_updated", // Default YouTube order
  DATE_ADDED = "date_added", // Manual drag order
  ALPHABETICAL = "alphabetical", // A-Z by title
}
```

#### Storage Keys

```typescript
enum StorageKey {
  STATE = "queueboard_state_v1", // Full playlist data
  SORT = "queueboard_sort_v1", // Manual drag order
  GAPI_TOKEN = "queueboard_gapi_token", // YouTube auth token
  NEXT_PAGE_TOKEN = "queueboard_next_page_token_v1", // Pagination (disabled)
  PLAYLIST_SORT_ORDER = "queueboard_playlist_sort_order_v1", // Sort method
}
```

## Key Patterns & Conventions

### State Management

- **Signals**: Angular 21 signals for reactive state (`playlists = signal<PlaylistColumn[]>([])`)
- **Immutable Updates**: Always copy arrays before calling `.set()` on signals
- **Computed Values**: Derived state using `computed()` for filtered playlists

### YouTube API Integration

- **Runtime Script Loading**: Loads `apis.google.com/js/api.js` and `accounts.google.com/gsi/client` dynamically
- **Token Management**: Stores access tokens in sessionStorage with expiry
- **Error Handling**: Specialized error handling for YouTube API responses
- **Scope**: `https://www.googleapis.com/auth/youtube` (read-only)

### Sorting System

1. **Last Updated (Default)**: Uses YouTube's natural order
2. **Date Added**: Uses manual drag-and-drop order (`sortId` field)
3. **Alphabetical**: Sorts by playlist title
4. **Synchronization**: Manual sort order syncs with current playlist state when sort method changes

### Drag & Drop

- **CDK DragDrop**: Angular CDK for drag-and-drop functionality
- **Video Movement**: Between playlists via YouTube API (remove + add)
- **Playlist Reordering**: Updates manual sort order and saves to localStorage
- **State Persistence**: Automatically saves state after drag operations

### SSR Safety

- **Platform Checks**: `isPlatformBrowser()` guards for DOM/localStorage access
- **Window Guards**: `if (typeof window === 'undefined')` for client-only code
- **Storage Service**: Handles SSR-safe localStorage operations

### Pagination (Currently Disabled)

- **Structure Preserved**: All pagination code commented with TODO markers
- **High Limits**: Uses `maxResults = 50` to fetch all items at once
- **Re-enable Path**: Uncomment pageToken usage and reduce maxResults

## Development Workflow

### Commands

```bash
# Install dependencies
cd queueboard && npm install

# Development server
npm start                    # Runs ng serve

# Build (with SSR)
ng build                     # Creates dist/queueboard/

# SSR server
npm run serve:ssr:queueboard # Runs built SSR server

# Testing
npm test                     # Runs Karma tests
```

### Environment Configuration

```typescript
// src/env/environment.ts
export const environment = {
  production: true,
  googleClientId: "YOUR_CLIENT_ID", // Google OAuth client ID
  googleApiKey: "YOUR_API_KEY", // YouTube Data API key
  pollingIntervalMinutes: 60, // Background refresh interval
};
```

### Build Targets

- **Browser Bundle**: `dist/queueboard/browser/` - Client-side assets
- **Server Bundle**: `dist/queueboard/server/` - SSR server code
- **Development**: `ng serve` for SPA development
- **Production**: `ng build` + `npm run serve:ssr:queueboard` for SSR

## Common Tasks & References

### Adding New Features

1. **Components**: Create in `src/app/organizer/` for playlist-related features
2. **Services**: Add to `src/app/services/` for shared logic
3. **Types**: Update `youtube-api.types.ts` for YouTube-related types
4. **Storage**: Add new keys to `StorageKey` enum if persistence needed

### YouTube API Operations

- **Fetch Playlists**: `youtube.fetchPlaylists(pageToken?, maxResults?)`
- **Fetch Videos**: `youtube.fetchPlaylistItems(playlistId, maxResults?, pageToken?)`
- **Add Video**: `youtube.addVideoToPlaylist(playlistId, videoId)`
- **Remove Video**: `youtube.removeVideoFromPlaylist(playlistItemId)`

### State Management Patterns

```typescript
// Signal updates
const curr = [...this.playlists()];
curr[idx] = { ...curr[idx], videos: mapped };
this.playlists.set(curr);

// Storage operations
this.storage.setItem(StorageKey.STATE, this.playlists());
const saved = this.storage.getItem<PlaylistColumn[]>(StorageKey.STATE, null);

// Sort application
const sortedPlaylists = this.playlistService.applySort(playlists);
this.playlists.set(sortedPlaylists);
```

### Debugging Tips

- **Console Logs**: Check browser console for YouTube API errors
- **Network Tab**: Monitor YouTube API requests and responses
- **LocalStorage**: Inspect stored state using browser dev tools
- **Player Issues**: Check YouTube player iframe initialization

## Dependencies

### Core Framework

- **@angular/core**: ^21.0.0-next.5 (Signals, standalone components)
- **@angular/cdk**: ^21.0.0-next.5 (Drag & drop)
- **@angular/ssr**: ^21.0.0-next.5 (Server-side rendering)

### UI & Styling

- **bootstrap**: ^5.3.8 (CSS framework)
- **@angular/youtube-player**: ^21.0.0-next.6 (YouTube integration)

### Backend

- **express**: ^5.1.0 (SSR server)

## File Reference Quick Guide

| Feature        | Primary Files                                       |
| -------------- | --------------------------------------------------- |
| Main UI        | `organizer/organizer.component.*`                   |
| YouTube API    | `services/youtube-api.service.ts`                   |
| Playlist Logic | `services/playlist.service.ts`                      |
| Video Player   | `organizer/video-player/*`                          |
| Storage        | `services/StorageService.ts`                        |
| Types          | `services/youtube-api.types.ts`                     |
| Routing        | `app.routes.ts`                                     |
| Config         | `app.config.ts`, `angular.json`                     |
| Styles         | `organizer/organizer.component.scss`, `styles.scss` |

This documentation provides GitHub Copilot with comprehensive context about the QueueBoard project structure, patterns, and implementation details to minimize the need for extensive code searches.
