export const PLAYER_MESSAGE_TYPE = 'englizeka-player-command' as const;
export const PLAYER_EVENT_TYPE = 'englizeka-player-event' as const;

export type PlayerState = 'unstarted' | 'playing' | 'paused' | 'buffering' | 'ended';

export type PlayerCommand =
  | { type: typeof PLAYER_MESSAGE_TYPE; videoId: string; command: 'play' | 'pause' | 'mute' | 'unmute' | 'request-status' }
  | { type: typeof PLAYER_MESSAGE_TYPE; videoId: string; command: 'seek' | 'set-volume'; value: number };

export type PlayerEvent =
  | { type: typeof PLAYER_EVENT_TYPE; videoId: string; event: 'ready' }
  | { type: typeof PLAYER_EVENT_TYPE; videoId: string; event: 'state'; state: PlayerState }
  | { type: typeof PLAYER_EVENT_TYPE; videoId: string; event: 'progress'; currentTime: number; duration: number }
  | { type: typeof PLAYER_EVENT_TYPE; videoId: string; event: 'volume'; volume: number; muted: boolean }
  | { type: typeof PLAYER_EVENT_TYPE; videoId: string; event: 'error'; code: number };

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function hasVideoId(value: Record<string, unknown>): value is Record<string, unknown> & { videoId: string } {
  return typeof value.videoId === 'string' && value.videoId.length > 0;
}

export function parsePlayerCommand(value: unknown, duration = Number.POSITIVE_INFINITY): PlayerCommand | null {
  const data = recordOf(value);
  if (!data || data.type !== PLAYER_MESSAGE_TYPE || !hasVideoId(data)) return null;
  if (data.command === 'play' || data.command === 'pause' || data.command === 'mute' || data.command === 'unmute' || data.command === 'request-status') {
    return { type: PLAYER_MESSAGE_TYPE, videoId: data.videoId, command: data.command };
  }
  if (data.command !== 'seek' && data.command !== 'set-volume') return null;
  if (typeof data.value !== 'number' || !Number.isFinite(data.value)) return null;
  const maximum = data.command === 'seek' ? duration : 100;
  if (data.value < 0 || data.value > maximum) return null;
  return { type: PLAYER_MESSAGE_TYPE, videoId: data.videoId, command: data.command, value: data.value };
}

export function parseTrustedPlayerEvent({
  data,
  eventOrigin,
  expectedOrigin,
  sourceMatches,
  videoId,
}: {
  data: unknown;
  eventOrigin: string;
  expectedOrigin: string;
  sourceMatches: boolean;
  videoId: string;
}): PlayerEvent | null {
  if (!sourceMatches || eventOrigin !== expectedOrigin) return null;
  const message = parsePlayerEvent(data);
  return message?.videoId === videoId ? message : null;
}

export function shouldRequestPlayerStatus(listenerReady: boolean, iframeLoaded: boolean): boolean {
  return listenerReady && iframeLoaded;
}

export function parsePlayerEvent(value: unknown): PlayerEvent | null {
  const data = recordOf(value);
  if (!data || data.type !== PLAYER_EVENT_TYPE || !hasVideoId(data)) return null;
  if (data.event === 'ready') return { type: PLAYER_EVENT_TYPE, videoId: data.videoId, event: 'ready' };
  if (data.event === 'state') {
    if (!['unstarted', 'playing', 'paused', 'buffering', 'ended'].includes(String(data.state))) return null;
    return { type: PLAYER_EVENT_TYPE, videoId: data.videoId, event: 'state', state: data.state as PlayerState };
  }
  if (data.event === 'progress') {
    if (typeof data.currentTime !== 'number' || !Number.isFinite(data.currentTime) || data.currentTime < 0) return null;
    if (typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration < 0) return null;
    if (data.duration > 0 && data.currentTime > data.duration + 1) return null;
    return { type: PLAYER_EVENT_TYPE, videoId: data.videoId, event: 'progress', currentTime: data.currentTime, duration: data.duration };
  }
  if (data.event === 'volume') {
    if (typeof data.volume !== 'number' || !Number.isFinite(data.volume) || data.volume < 0 || data.volume > 100 || typeof data.muted !== 'boolean') return null;
    return { type: PLAYER_EVENT_TYPE, videoId: data.videoId, event: 'volume', volume: data.volume, muted: data.muted };
  }
  if (data.event === 'error') {
    if (typeof data.code !== 'number' || !Number.isFinite(data.code)) return null;
    return { type: PLAYER_EVENT_TYPE, videoId: data.videoId, event: 'error', code: data.code };
  }
  return null;
}
