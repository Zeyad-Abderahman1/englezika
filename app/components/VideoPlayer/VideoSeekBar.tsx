'use client';

import { useEffect, useRef, useState } from 'react';
import { clampSeekTime, positionFromPointer } from './playerUtils';
import styles from './VideoPlayer.module.css';

export default function VideoSeekBar({
  currentTime,
  duration,
  onSeek,
  onInteractionChange,
}: {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onInteractionChange: (active: boolean) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  useEffect(() => () => onInteractionChange(false), [onInteractionChange]);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? positionFromPointer(clientX, rect.left, rect.width, duration) : 0;
  };
  const displayedTime = isScrubbing ? scrubTime : currentTime;
  const percent = duration > 0 ? (clampSeekTime(displayedTime, duration) / duration) * 100 : 0;

  return (
    <div
      ref={trackRef}
      className={`${styles.seekBar} ${isScrubbing ? styles.scrubbing : ''}`}
      role="slider"
      aria-label="موضع الفيديو"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration)}
      aria-valuenow={Math.floor(displayedTime)}
      tabIndex={0}
      data-player-interactive
      onPointerDown={(event) => {
        if (duration <= 0) return;
        event.preventDefault();
        scrubbingRef.current = true;
        setIsScrubbing(true);
        setScrubTime(timeAt(event.clientX));
        onInteractionChange(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (scrubbingRef.current) setScrubTime(timeAt(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!scrubbingRef.current) return;
        const nextTime = timeAt(event.clientX);
        scrubbingRef.current = false;
        setIsScrubbing(false);
        setScrubTime(nextTime);
        onSeek(nextTime);
        onInteractionChange(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        scrubbingRef.current = false;
        setIsScrubbing(false);
        onInteractionChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          onSeek(currentTime + (event.key === 'ArrowRight' ? 5 : -5));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onSeek(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          onSeek(duration);
        }
      }}
    >
      <span className={styles.seekTrack}>
        <span className={styles.seekFill} style={{ width: `${percent}%` }} />
        <span className={styles.seekThumb} style={{ insetInlineStart: `${percent}%` }} />
      </span>
    </div>
  );
}
