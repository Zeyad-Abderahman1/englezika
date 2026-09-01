'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Play, ShieldCheck, UserRound } from 'lucide-react';
import VideoControls from './VideoControls';
import VideoGestureLayer from './VideoGestureLayer';
import { PLAYER_MESSAGE_TYPE, parseTrustedPlayerEvent, shouldRequestPlayerStatus, type PlayerCommand, type PlayerState } from './playerProtocol';
import {
  clampSeekTime,
  isEditableTarget,
  keyboardActionForKey,
  normalizeVolume,
  shouldAutoHideControls,
  shouldReportEnded,
} from './playerUtils';
import styles from './VideoPlayer.module.css';

const INITIALIZATION_TIMEOUT_MS = 12_000;

export default function EnglizekaPlayer({
  videoId,
  title,
  sourceUrl,
  viewerEmail,
  onEnded,
}: {
  videoId: string;
  title: string;
  sourceUrl: string;
  viewerEmail: string;
  onEnded: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeLoadedRef = useRef(false);
  const listenerReadyRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousStateRef = useRef<PlayerState>('unstarted');
  const interactionRef = useRef(false);
  const focusRef = useRef(false);
  const [playerState, setPlayerState] = useState<PlayerState>('unstarted');
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState(false);
  const [initializationTimedOut, setInitializationTimedOut] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [protectionMessage, setProtectionMessage] = useState('');

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback((state: PlayerState = playerState) => {
    clearHideTimer();
    setControlsVisible(true);
    if (shouldAutoHideControls(state, interactionRef.current, focusRef.current)) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, [clearHideTimer, playerState]);

  const sendCommand = useCallback((command: PlayerCommand['command'], value?: number) => {
    const message = value === undefined
      ? { type: PLAYER_MESSAGE_TYPE, videoId, command }
      : { type: PLAYER_MESSAGE_TYPE, videoId, command, value };
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, [videoId]);

  const requestStatus = useCallback(() => sendCommand('request-status'), [sendCommand]);

  const togglePlayback = useCallback(() => {
    sendCommand(playerState === 'playing' ? 'pause' : 'play');
    scheduleAutoHide(playerState === 'playing' ? 'paused' : 'playing');
  }, [playerState, scheduleAutoHide, sendCommand]);

  const seekTo = useCallback((seconds: number) => {
    if (duration <= 0) return;
    const bounded = clampSeekTime(seconds, duration);
    setCurrentTime(bounded);
    sendCommand('seek', bounded);
    scheduleAutoHide();
  }, [duration, scheduleAutoHide, sendCommand]);

  const seekBy = useCallback((delta: number) => seekTo(currentTime + delta), [currentTime, seekTo]);

  const toggleMute = useCallback(() => {
    sendCommand(muted || volume === 0 ? 'unmute' : 'mute');
    scheduleAutoHide();
  }, [muted, scheduleAutoHide, sendCommand, volume]);

  const changeVolume = useCallback((next: number) => {
    const normalized = normalizeVolume(next);
    setVolume(normalized);
    setMuted(false);
    if (muted) sendCommand('unmute');
    sendCommand('set-volume', normalized);
  }, [muted, sendCommand]);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement === rootRef.current) await document.exitFullscreen();
    else await rootRef.current?.requestFullscreen();
  }, []);

  const setInteracting = useCallback((active: boolean) => {
    interactionRef.current = active;
    if (active) {
      clearHideTimer();
      setControlsVisible(true);
    } else scheduleAutoHide();
  }, [clearHideTimer, scheduleAutoHide]);

  useEffect(() => {
    const receivePlayerEvent = (event: MessageEvent) => {
      const message = parseTrustedPlayerEvent({
        data: event.data,
        eventOrigin: event.origin,
        expectedOrigin: window.location.origin,
        sourceMatches: event.source === iframeRef.current?.contentWindow,
        videoId,
      });
      if (!message) return;
      if (message.event === 'ready') {
        setReady(true);
        setError(false);
        setInitializationTimedOut(false);
      } else if (message.event === 'state') {
        setPlayerState(message.state);
        scheduleAutoHide(message.state);
        const reportEnded = shouldReportEnded(previousStateRef.current, message.state);
        previousStateRef.current = message.state;
        if (reportEnded) onEnded();
      } else if (message.event === 'progress') {
        setCurrentTime(message.currentTime);
        setDuration(message.duration);
      } else if (message.event === 'volume') {
        setVolume(message.volume);
        setMuted(message.muted);
      } else if (message.event === 'error') {
        setError(true);
        setPlayerState('paused');
      }
    };
    window.addEventListener('message', receivePlayerEvent);
    listenerReadyRef.current = true;
    if (shouldRequestPlayerStatus(listenerReadyRef.current, iframeLoadedRef.current)) requestStatus();
    return () => {
      listenerReadyRef.current = false;
      window.removeEventListener('message', receivePlayerEvent);
    };
  }, [onEnded, requestStatus, scheduleAutoHide, videoId]);

  useEffect(() => {
    if (ready || error) return;
    const timeout = setTimeout(() => setInitializationTimedOut(true), INITIALIZATION_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [error, ready, retryKey]);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useEffect(() => {
    const protectOnVisibilityChange = () => {
      if (!document.hidden) return;
      sendCommand('pause');
      setProtectionMessage('تم إيقاف الفيديو بسبب مغادرة صفحة المشاهدة');
      setControlsVisible(true);
    };
    document.addEventListener('visibilitychange', protectOnVisibilityChange);
    return () => document.removeEventListener('visibilitychange', protectOnVisibilityChange);
  }, [sendCommand]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const isPlaying = playerState === 'playing';

  return (
    <div
      ref={rootRef}
      className={`${styles.player} ${controlsVisible ? styles.playerControlsVisible : ''}`}
      tabIndex={0}
      dir="rtl"
      onContextMenu={(event) => event.preventDefault()}
      onPointerMove={() => scheduleAutoHide()}
      onFocusCapture={() => {
        focusRef.current = true;
        clearHideTimer();
        setControlsVisible(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focusRef.current = false;
          scheduleAutoHide();
        }
      }}
      onKeyDown={(event) => {
        if (isEditableTarget(event.target)) return;
        const action = keyboardActionForKey(event.key);
        if (!action) return;
        const target = event.target as HTMLElement;
        if (action === 'toggle' && target.tagName === 'BUTTON') return;
        event.preventDefault();
        if (action === 'toggle') togglePlayback();
        if (action === 'forward') seekBy(5);
        if (action === 'backward') seekBy(-5);
        if (action === 'mute') toggleMute();
        if (action === 'fullscreen') void toggleFullscreen();
      }}
    >
      <iframe
        key={`${sourceUrl}:${retryKey}`}
        ref={iframeRef}
        className={styles.engine}
        src={sourceUrl}
        title={title}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        onLoad={() => {
          iframeLoadedRef.current = true;
          if (shouldRequestPlayerStatus(listenerReadyRef.current, iframeLoadedRef.current)) requestStatus();
        }}
      />
      <VideoGestureLayer
        isPlaying={isPlaying}
        onTogglePlayback={togglePlayback}
        onSeekBy={seekBy}
        onInteraction={() => scheduleAutoHide()}
      />
      <div className={`${styles.watermark} ${styles.watermarkTop}`} aria-label={`المشاهد ${viewerEmail}`}>
        <UserRound /> <bdi>{viewerEmail}</bdi>
      </div>
      <div className={`${styles.watermark} ${styles.watermarkTrace}`} aria-hidden="true">
        <bdi>{viewerEmail}</bdi>
      </div>
      {!ready && !error && !initializationTimedOut && (
        <div className={styles.loadingState} role="status">
          <LoaderCircle className={styles.spinner} />
          <strong>جاري تجهيز مشغل إنجليزيكا...</strong>
        </div>
      )}
      {playerState === 'buffering' && ready && !error && (
        <div className={styles.bufferingState} role="status" aria-label="جاري تحميل الفيديو">
          <LoaderCircle className={styles.spinner} />
        </div>
      )}
      {playerState === 'ended' && ready && !error && (
        <button type="button" className={styles.replayButton} onClick={() => { seekTo(0); sendCommand('play'); }} aria-label="إعادة تشغيل الفيديو">
          <Play fill="currentColor" />
        </button>
      )}
      {(error || initializationTimedOut) && (
        <div className={styles.errorState} role="alert">
          <AlertTriangle />
          <strong>تعذر تجهيز مشغل الفيديو</strong>
          <p>حاول مرة أخرى.</p>
          <button
            type="button"
            onClick={() => {
              iframeLoadedRef.current = false;
              previousStateRef.current = 'unstarted';
              setReady(false);
              setError(false);
              setInitializationTimedOut(false);
              setPlayerState('unstarted');
              setCurrentTime(0);
              setDuration(0);
              setRetryKey((value) => value + 1);
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      )}
      {protectionMessage && (
        <div className={styles.protectionState} role="alert" aria-live="assertive">
          <ShieldCheck />
          <h2>نظام المشاهدة الآمن</h2>
          <p>{protectionMessage}</p>
          <button type="button" onClick={() => { setProtectionMessage(''); sendCommand('play'); }}>
            <Play /> العودة للمشاهدة
          </button>
        </div>
      )}
      {ready && !error && !initializationTimedOut && !protectionMessage && (
        <VideoControls
          visible={controlsVisible}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          muted={muted}
          isFullscreen={isFullscreen}
          onTogglePlayback={togglePlayback}
          onSeek={seekTo}
          onSeekBy={seekBy}
          onVolumeChange={changeVolume}
          onToggleMute={toggleMute}
          onToggleFullscreen={() => void toggleFullscreen()}
          onInteractionChange={setInteracting}
        />
      )}
    </div>
  );
}
