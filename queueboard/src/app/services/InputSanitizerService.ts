import { Injectable } from '@angular/core';

/**
 * Service for sanitizing user input across the application.
 * Prevents XSS, injection attacks, and performance issues.
 */
@Injectable({
  providedIn: 'root'
})
export class InputSanitizerService {
  private readonly MAX_SEARCH_LENGTH = 200;
  private readonly MAX_TITLE_LENGTH = 500;

  /**
   * Sanitizes search query input
   * - Trims whitespace
   * - Limits length to prevent DoS via long searches
   * - Removes control characters and potential HTML
   */
  sanitizeSearchQuery(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input
      .trim()
      .slice(0, this.MAX_SEARCH_LENGTH)
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
      .replace(/[<>]/g, ''); // Remove potential HTML tags
  }

  /**
   * Escapes HTML special characters to prevent XSS
   */
  escapeHtml(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
      '/': '&#x2F;'
    };

    return text.replace(/[&<>"'\/]/g, (char) => map[char] || char);
  }

  /**
   * Validates and sanitizes a YouTube video ID
   * YouTube video IDs are 11 characters: [a-zA-Z0-9_-]
   */
  sanitizeVideoId(videoId: string): string | null {
    if (!videoId || typeof videoId !== 'string') {
      return null;
    }

    const cleanId = videoId.trim();
    const videoIdPattern = /^[a-zA-Z0-9_-]{11}$/;

    return videoIdPattern.test(cleanId) ? cleanId : null;
  }

  /**
   * Validates and sanitizes a YouTube playlist ID
   * Playlist IDs start with PL/UU/FL/RD followed by alphanumeric characters
   */
  sanitizePlaylistId(playlistId: string): string | null {
    if (!playlistId || typeof playlistId !== 'string') {
      return null;
    }

    const cleanId = playlistId.trim();
    const playlistIdPattern = /^(PL|UU|FL|RD)[a-zA-Z0-9_-]{16,34}$/;

    return playlistIdPattern.test(cleanId) ? cleanId : null;
  }

  /**
   * Safely truncates text without breaking words
   */
  truncateText(text: string, maxLength: number, ellipsis: string = '...'): string {
    if (!text || text.length <= maxLength) {
      return text;
    }

    const truncated = text.slice(0, maxLength - ellipsis.length);
    const lastSpace = truncated.lastIndexOf(' ');

    // If there's a space, cut at word boundary
    if (lastSpace > maxLength * 0.8) {
      return truncated.slice(0, lastSpace) + ellipsis;
    }

    return truncated + ellipsis;
  }

  /**
   * Validates a URL is from an allowed domain (YouTube only)
   */
  isAllowedYouTubeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const allowedDomains = ['youtube.com', 'youtu.be'];
      return allowedDomains.some(domain => 
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
      );
    } catch {
      return false;
    }
  }

  /**
   * Validates video title length and content
   */
  sanitizeVideoTitle(title: string): string {
    if (!title || typeof title !== 'string') {
      return 'Untitled Video';
    }

    return this.truncateText(title.trim(), this.MAX_TITLE_LENGTH);
  }
}