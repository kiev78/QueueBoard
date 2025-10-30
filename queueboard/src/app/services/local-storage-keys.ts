export const LOCAL_STORAGE_KEYS = {
  STATE: 'queueboard_state_v1',
  SORT: 'queueboard_sort_v1',
  PLAYLIST_SORT_ORDER: 'queueboard_sort_order_v1',
  GAPI_TOKEN: 'queueboard_gapi_token',
  NEXT_PAGE_TOKEN: 'queueboard_next_page_token_v1',
  DARK_MODE: 'queueboard_dark_mode_v1',
  TRANSFER_GOOGLE: 'queueboard_transfer_google_v1',
} as const;

export type LocalStorageKey = (typeof LOCAL_STORAGE_KEYS)[keyof typeof LOCAL_STORAGE_KEYS];
