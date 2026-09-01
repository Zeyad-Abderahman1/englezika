'use client';

import {
  FastForward,
  Maximize,
  Minimize,
  Pause,
  Play,
  Rewind,
  Volume2,
  VolumeX,
} from 'lucide-react';
import VideoSeekBar from './VideoSeekBar';
import { formatVideoTime } from './playerUtils';
import styles from './VideoPlayer.module.css';

export default function VideoControls({
  visible,
  isPlaying,
  currentTime,
  duration,
  volume,
  muted,
  isFullscreen,
  onTogglePlayback,
  onSeek,
  onSeekBy,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onInteractionChange,
}: {
  visible: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  isFullscreen: boolean;
  onTogglePlayback: () => void;
  onSeek: (seconds: number) => void;
  onSeekBy: (delta: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onInteractionChange: (active: boolean) => void;
}) {
  return (
    <div
      className={`${styles.controls} ${visible ? styles.controlsVisible : ''}`}
      data-player-interactive
      onPointerDown={() => onInteractionChange(true)}
      onPointerUp={() => onInteractionChange(false)}
      onPointerCancel={() => onInteractionChange(false)}
    >
      <VideoSeekBar
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        onInteractionChange={onInteractionChange}
      />
      <div className={styles.controlRow}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.primaryButton}`}
          aria-label={isPlaying ? 'إيقاف الفيديو مؤقتًا' : 'تشغيل الفيديو'}
          onClick={onTogglePlayback}
        >
          {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button type="button" className={`${styles.iconButton} ${styles.skipButton}`} aria-label="رجوع 10 ثوانٍ" onClick={() => onSeekBy(-10)}>
          <Rewind /><span>10</span>
        </button>
        <button type="button" className={`${styles.iconButton} ${styles.skipButton}`} aria-label="تقديم 10 ثوانٍ" onClick={() => onSeekBy(10)}>
          <span>10</span><FastForward />
        </button>
        <span className={styles.time} dir="ltr">
          <b>{formatVideoTime(currentTime)}</b><span>/</span>{formatVideoTime(duration)}
        </span>
        <div className={styles.volumeGroup}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={muted || volume === 0 ? 'تشغيل الصوت' : 'كتم الصوت'}
            onClick={onToggleMute}
          >
            {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            className={styles.volumeSlider}
            type="range"
            min="0"
            max="100"
            step="1"
            value={muted ? 0 : volume}
            aria-label="مستوى الصوت"
            onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
            onFocus={() => onInteractionChange(true)}
            onBlur={() => onInteractionChange(false)}
          />
        </div>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.fullscreenButton}`}
          aria-label={isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? <Minimize /> : <Maximize />}
        </button>
      </div>
    </div>
  );
}
