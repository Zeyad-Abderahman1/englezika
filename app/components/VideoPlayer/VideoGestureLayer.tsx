'use client';

import { useEffect, useRef, useState } from 'react';
import { FastForward, Pause, Play, Rewind } from 'lucide-react';
import { classifyPointerZone, classifyTapAction, shouldIgnoreGestureTarget, type PointerZone } from './playerUtils';
import styles from './VideoPlayer.module.css';

const DOUBLE_TAP_MS = 300;

type Feedback = { key: number; action: 'play' | 'pause' | 'backward' | 'forward' } | null;

export default function VideoGestureLayer({
  isPlaying,
  onTogglePlayback,
  onSeekBy,
  onInteraction,
}: {
  isPlaying: boolean;
  onTogglePlayback: () => void;
  onSeekBy: (delta: number) => void;
  onInteraction: () => void;
}) {
  const pendingTap = useRef<{ zone: PointerZone; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => () => {
    if (pendingTap.current) clearTimeout(pendingTap.current.timer);
  }, []);

  const showFeedback = (action: NonNullable<Feedback>['action']) => {
    setFeedback({ key: Date.now(), action });
  };

  const runDoubleTap = (zone: PointerZone) => {
    const action = classifyTapAction(zone, zone);
    if (action === 'backward') {
      onSeekBy(-10);
      showFeedback('backward');
    } else if (action === 'forward') {
      onSeekBy(10);
      showFeedback('forward');
    }
  };

  return (
    <div
      className={styles.gestureLayer}
      aria-hidden="true"
      onContextMenu={(event) => event.preventDefault()}
      onPointerUp={(event) => {
        if (event.button !== 0 || shouldIgnoreGestureTarget(event.target)) return;
        onInteraction();
        const rect = event.currentTarget.getBoundingClientRect();
        const zone = classifyPointerZone(event.clientX - rect.left, rect.width);
        if (pendingTap.current) {
          const first = pendingTap.current;
          clearTimeout(first.timer);
          pendingTap.current = null;
          if (first.zone === zone) runDoubleTap(zone);
          return;
        }
        const timer = setTimeout(() => {
          pendingTap.current = null;
          if (classifyTapAction(zone) === 'toggle') {
            onTogglePlayback();
            showFeedback(isPlaying ? 'pause' : 'play');
          }
        }, DOUBLE_TAP_MS);
        pendingTap.current = { zone, timer };
      }}
    >
      {feedback && (
        <span
          key={feedback.key}
          className={`${styles.gestureFeedback} ${styles[feedback.action]}`}
          onAnimationEnd={() => setFeedback(null)}
        >
          {feedback.action === 'play' && <Play fill="currentColor" />}
          {feedback.action === 'pause' && <Pause fill="currentColor" />}
          {feedback.action === 'backward' && <><Rewind /><b>10</b></>}
          {feedback.action === 'forward' && <><b>10</b><FastForward /></>}
        </span>
      )}
    </div>
  );
}
