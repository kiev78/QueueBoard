/**
 * Type definitions for YouTube Data API v3 responses.
 * Provides type safety and reduces reliance on 'any' casts.
 */

export interface YouTubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface YouTubeThumbnails {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

export interface YouTubeResourceId {
  kind: 'youtube#video' | 'youtube#playlist' | 'youtube#channel';
  videoId?: string;
  playlistId?: string;
  channelId?: string;
}

// Playlist
export interface YouTubePlaylistSnippet {
  publishedAt?: string;
  channelId?: string;
  title?: string;
  description?: string;
  thumbnails?: YouTubeThumbnails;
  channelTitle?: string;
  defaultLanguage?: string;
  localized?: {
    title?: string;
    description?: string;
  };
}

export interface YouTubePlaylistContentDetails {
  itemCount?: number;
}

export interface YouTubePlaylistStatus {
  privacyStatus?: string;
}

export interface YouTubePlaylistPlayer {
  embedHtml?: string;
}

export interface YouTubePlaylist {
  kind: 'youtube#playlist';
  etag?: string;
  id: string;
  snippet?: YouTubePlaylistSnippet;
  status?: YouTubePlaylistStatus;
  contentDetails?: YouTubePlaylistContentDetails;
  player?: YouTubePlaylistPlayer;
  localizations?: {
    [key: string]: {
      title?: string;
      description?: string;
    };
  };
}
 

export interface YouTubePlaylistItemContentDetails {
  videoId?: string;
  startAt?: string;
  endAt?: string;
  note?: string;
    duration?: string;
  videoPublishedAt?: string;
}

export interface YouTubePlaylistItemStatus {
  privacyStatus?: string;
}

export interface YouTubePlaylistItem {
  kind: 'youtube#playlistItem';
  etag?: string;
  id: string;
  snippet?: YouTubeVideoSnippet;
  contentDetails?: YouTubeVideoContentDetails;
  status?: YouTubePlaylistItemStatus;
}

// Video
export interface YouTubeVideoSnippet {
  publishedAt?: string;
  channelId?: string;
  title?: string;
  description?: string;
  thumbnails?: YouTubeThumbnails;
  channelTitle?: string;
  tags?: string[];
  categoryId?: string;
  liveBroadcastContent?: string;
  defaultLanguage?: string;
  localized?: {
    title?: string;
    description?: string;
  };
  defaultAudioLanguage?: string;
  resourceId: YouTubeResourceId;
}

export interface YouTubeVideoContentDetails {
  videoId?: string;
  duration?: string;
  dimension?: string;
  definition?: string;
  caption?: string;
  licensedContent?: boolean;
  regionRestriction?: {
    allowed?: string[];
    blocked?: string[];
  };
  contentRating?: any; // This is a complex object, using any for now
  projection?: string;
  hasCustomThumbnail?: boolean;
}

export interface YouTubeVideoStatus {
    uploadStatus?: string;
    failureReason?: string;
    rejectionReason?: string;
    privacyStatus?: string;
    publishAt?: string;
    license?: string;
    embeddable?: boolean;
    publicStatsViewable?: boolean;
    madeForKids?: boolean;
    selfDeclaredMadeForKids?: boolean;
}

export interface YouTubeVideoStatistics {
    viewCount?: string;
    likeCount?: string;
    dislikeCount?: string;
    favoriteCount?: string;
    commentCount?: string;
}

export interface YouTubeVideoPlayer {
    embedHtml?: string;
    embedHeight?: number;
    embedWidth?: number;
}

export interface YouTubeVideo {
  kind: 'youtube#video';
  etag?: string;
  id: string;
  snippet?: YouTubeVideoSnippet;
  contentDetails?: YouTubeVideoContentDetails;
  status?: YouTubeVideoStatus;
  statistics?: YouTubeVideoStatistics;
  player?: YouTubeVideoPlayer;
}

// Playlist Image
export interface YouTubePlaylistImage {
    kind: "youtube#playlistImage",
    id: string,
    snippet: {
        playlistId: string,
        type: string,
        width: string,
        height: string,
    }
}


// API Response
export interface YouTubeApiResponse<T> {
  kind?: string;
  etag?: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo?: {
    totalResults?: number;
    resultsPerPage?: number;
  };
  items: T[];
}

/**
 * Normalized video data for internal application use
 */
export interface NormalizedPlaylistVideo {
  id: string;
  playlistItemId: string;
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  duration: string;
  tags: string[];
  youtubeUrl: string;
}

/**
 * Type guards for API responses
 */
export function isPlaylistItem(item: unknown): item is YouTubePlaylistItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    (item as any).kind === 'youtube#playlistItem' &&
    typeof (item as any).id === 'string'
  );
}

export function isVideo(item: unknown): item is YouTubeVideo {
  return (
    typeof item === 'object' &&
    item !== null &&
    (item as any).kind === 'youtube#video' &&
    typeof (item as any).id === 'string'
  );
}

export function isPlaylist(item: unknown): item is YouTubePlaylist {
  return (
    typeof item === 'object' &&
    item !== null &&
    (item as any).kind === 'youtube#playlist' &&
    typeof (item as any).id === 'string'
  );
}

export function isApiResponse<T>(response: unknown): response is YouTubeApiResponse<T> {
  return (
    typeof response === 'object' &&
    response !== null &&
    Array.isArray((response as any).items)
  );
}
