export type PointerZone = 'left' | 'center' | 'right';
export type TapAction = 'toggle' | 'backward' | 'forward' | 'none';
export type KeyboardAction = 'toggle' | 'forward' | 'backward' | 'mute' | 'fullscreen';

export function clampSeekTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(seconds, duration));
}

export function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function classifyPointerZone(offsetX: number, width: number): PointerZone {
  if (!Number.isFinite(width) || width <= 0) return 'center';
  const ratio = Math.max(0, Math.min(offsetX, width)) / width;
  if (ratio < 0.33) return 'left';
  if (ratio < 0.67) return 'center';
  return 'right';
}

export function classifyTapAction(first: PointerZone, second?: PointerZone): TapAction {
  if (!second) return first === 'center' ? 'toggle' : 'none';
  if (first !== second) return 'none';
  if (second === 'left') return 'backward';
  if (second === 'right') return 'forward';
  return 'none';
}

export function positionFromPointer(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  duration: number
): number {
  if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - trackLeft) / trackWidth));
  return clampSeekTime(ratio * duration, duration);
}

export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown };
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : '';
  return candidate.isContentEditable === true || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function shouldIgnoreGestureTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as { closest?: (selector: string) => unknown };
  if (typeof candidate.closest !== 'function') return false;
  return Boolean(candidate.closest('button, input, a, [role="slider"], [data-player-interactive]'));
}

export function shouldAutoHideControls(
  state: string,
  interactionActive: boolean,
  hasFocus: boolean
): boolean {
  return state === 'playing' && !interactionActive && !hasFocus;
}

export function keyboardActionForKey(key: string): KeyboardAction | null {
  if (key === ' ' || key === 'Spacebar') return 'toggle';
  if (key === 'ArrowRight') return 'forward';
  if (key === 'ArrowLeft') return 'backward';
  if (key.toLowerCase() === 'm') return 'mute';
  if (key.toLowerCase() === 'f') return 'fullscreen';
  return null;
}

export function normalizeVolume(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(value, 100));
}

export function shouldReportEnded(previousState: string, nextState: string): boolean {
  return previousState !== 'ended' && nextState === 'ended';
}
