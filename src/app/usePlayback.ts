import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import { cueAt, type Timeline } from '../animation/timeline';
import type { AudioEngine, NarrationFile } from '../audio/narration';
import type { SpeechNarrator } from '../audio/speechSynthesis';

export const POSTER_TIME = 8.1;

interface PlaybackDeps {
  project: Project;
  timeline: Timeline;
  engine: AudioEngine;
  narrator: SpeechNarrator;
  musicBuffer: AudioBuffer | null;
  narrationFile: NarrationFile | null;
}

export interface Playback {
  time: number;
  playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  restart(): void;
}

/**
 * Playback clock for the preview. While audio is playing, time follows the
 * Web Audio clock so the score and narration file stay in sync; otherwise a
 * requestAnimationFrame clock advances by elapsed time × preview speed.
 * Speech-synthesis cues are spoken as playback reaches each subtitle.
 */
export function usePlayback(deps: PlaybackDeps): Playback {
  // Open on a poster frame (title on screen) rather than the black iris at 0:00.
  const [time, setTime] = useState(POSTER_TIME);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(POSTER_TIME);
  const playingRef = useRef(false);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const startAudio = useCallback((t: number) => {
    const { project, engine, musicBuffer, narrationFile } = depsRef.current;
    const s = project.settings;
    const tracks: { buffer: AudioBuffer; gain: number }[] = [];
    if (s.music && musicBuffer) tracks.push({ buffer: musicBuffer, gain: s.musicVolume });
    if ((s.narrationMode === 'file' || s.narrationMode === 'studio') && narrationFile) tracks.push({ buffer: narrationFile.buffer, gain: 1 });
    engine.start(t, s.previewSpeed, tracks);
  }, []);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    depsRef.current.engine.stop();
    depsRef.current.narrator.cancel();
  }, []);

  const play = useCallback(() => {
    const { engine, timeline } = depsRef.current;
    engine.ensure();
    if (timeRef.current >= timeline.total - 0.05) {
      timeRef.current = 0;
      setTime(0);
    }
    depsRef.current.narrator.cancel();
    startAudio(timeRef.current);
    playingRef.current = true;
    setPlaying(true);
  }, [startAudio]);

  const seek = useCallback(
    (t: number) => {
      const total = depsRef.current.timeline.total;
      const clamped = Math.min(Math.max(0, t), total);
      timeRef.current = clamped;
      setTime(clamped);
      depsRef.current.narrator.cancel();
      if (playingRef.current) startAudio(clamped);
    },
    [startAudio],
  );

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);
  const restart = useCallback(() => seek(0), [seek]);

  // The animation loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const { engine, timeline, project, narrator } = depsRef.current;
      const s = project.settings;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const audioPos = engine.position();
      let t = audioPos ?? timeRef.current + dt * s.previewSpeed;
      if (t >= timeline.total) {
        t = timeline.total;
        timeRef.current = t;
        setTime(t);
        pause();
        return;
      }
      timeRef.current = t;
      setTime(t);
      // Browser voice: every cue in 'speech' mode; in 'studio' mode only lines the voice pack does not have yet.
      const cue = s.narrationMode === 'speech' || s.narrationMode === 'studio' ? cueAt(timeline, t) : undefined;
      if (cue && (s.narrationMode === 'speech' || cue.timing === 'estimated')) {
        if (t - cue.start < (cue.end - cue.start) * 0.6) {
          narrator.speakCue(cue.id, cue.text, s.voiceURI, s.speechRate * s.previewSpeed);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, pause]);

  // Restart audio when audio-related settings or the timeline change mid-playback.
  const s = deps.project.settings;
  useEffect(() => {
    if (playingRef.current) {
      depsRef.current.narrator.cancel();
      startAudio(timeRef.current);
    }
  }, [s.music, s.musicVolume, s.previewSpeed, s.narrationMode, s.voiceURI, s.speechRate, deps.musicBuffer, deps.narrationFile, deps.timeline, startAudio]);

  // Keep time inside the timeline when durations shrink.
  useEffect(() => {
    if (timeRef.current > deps.timeline.total) seek(deps.timeline.total);
  }, [deps.timeline, seek]);

  return useMemo(() => ({ time, playing, play, pause, toggle, seek, restart }), [time, playing, play, pause, toggle, seek, restart]);
}
