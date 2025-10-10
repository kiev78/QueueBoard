declare namespace YT {
    class Player {
        constructor(id: string, options: PlayerOptions);
        destroy(): void;
        getIframe(): HTMLIFrameElement;
        getPlaybackRate(): number;
        getAvailablePlaybackRates(): number[];
        setPlaybackRate(rate: number): void;
        playVideo(): void;
        pauseVideo(): void;
        stopVideo(): void;
        getVideoUrl(): string;
        getPlayerState(): PlayerState;
    }

    interface PlayerOptions {
        height?: string;
        width?: string;
        videoId?: string;
        playerVars?: PlayerVars;
        events?: PlayerEvents;
    }

    interface PlayerVars {
        autoplay?: 0 | 1;
        rel?: 0 | 1;
        [key: string]: any;
    }

    interface PlayerEvents {
        onReady?: (event: PlayerEvent) => void;
        onStateChange?: (event: PlayerEvent) => void;
        onPlaybackRateChange?: (event: PlayerEvent) => void;
    }

    interface PlayerEvent {
        target: Player;
        data: any;
    }

    enum PlayerState {
        UNSTARTED = -1,
        ENDED = 0,
        PLAYING = 1,
        PAUSED = 2,
        BUFFERING = 3,
        CUED = 5
    }
}
