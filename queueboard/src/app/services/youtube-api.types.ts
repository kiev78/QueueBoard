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

export interface YouTubePlaylistItemSnippet {
  publishedAt?: string;
  channelId?: string;
  title?: string;
  description?: string;
  thumbnails?: YouTubeThumbnails;
  channelTitle?: string;
  playlistId?: string;
  position?: number;
  resourceId?: YouTubeResourceId;
}

export interface YouTubePlaylistItemContentDetails {
  videoId?: string;
  startAt?: string;
  endAt?: string;
  note?: string;
  videoPublishedAt?: string;
  duration?: string;
}

export interface YouTubePlaylistItem {
  kind: 'youtube#playlistItem';
  etag?: string;
  id: string;
  snippet?: YouTubePlaylistItemSnippet;
  contentDetails?: YouTubePlaylistItemContentDetails;
}

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
}

export interface YouTubeVideoContentDetails {
  duration?: string;
  dimension?: string;
  definition?: string;
  caption?: string;
  licensedContent?: boolean;
  projection?: string;
}

export interface YouTubeVideo {
  kind: 'youtube#video';
  etag?: string;
  id: string;
  snippet?: YouTubeVideoSnippet;
  contentDetails?: YouTubeVideoContentDetails;
}

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

export interface YouTubePlaylist {
  kind: 'youtube#playlist';
  etag?: string;
  id: string;
  snippet?: YouTubePlaylistSnippet;
  contentDetails?: YouTubePlaylistContentDetails;
}

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