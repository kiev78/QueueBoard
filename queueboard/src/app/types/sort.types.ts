// Centralized sort-related type aliases.
// Keeping this minimal to avoid re-introducing legacy complexity.
export const PLAYLIST_SORT_ORDER = {
  CUSTOM: 'custom',
  ALPHABETICAL: 'alphabetical',
  RECENT: 'recent',
} as const;

export type PlaylistSortOrder = (typeof PLAYLIST_SORT_ORDER)[keyof typeof PLAYLIST_SORT_ORDER];

// Enum-like object allows referencing PLAYLIST_SORT_ORDER.CUSTOM etc.
