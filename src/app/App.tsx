import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectSettings, Scene, SubtitleStyle } from '../types';
import { STORAGE_KEY, createMkultraProject, restoreProject, switchLanguage } from '../data/mkultraProject';
import { buildTimeline, hasHook, locate, splitSentences } from '../animation/timeline';
import { fitMusicTrack, renderAmbience } from '../audio/ambience';
import { AudioEngine, type NarrationFile } from '../audio/narration';
import { SpeechNarrator, setSpeechLanguage, speechSupported, watchVoices } from '../audio/speechSynthesis';
import { loadStudioPack, probeVoiceServer, renderSentence, renderStudioTrack, studioTiming, type StudioPack } from '../audio/studioVoice';
import { studioVoiceFor } from '../audio/studioVoices';
import { scriptFor } from '../i18n/scripts';
import type { Lang } from '../i18n/languages';
import { usePlayback } from './usePlayback';
import { Header, type SaveStatus } from '../components/Header';
import { SceneList } from '../components/SceneList';
import { PreviewPlayer } from '../components/PreviewPlayer';
import { Timeline } from '../components/Timeline';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { ExportDialog } from '../components/ExportDialog';
import { SourcesPanel } from '../components/SourcesPanel';
import { ModelSheetDialog } from '../components/ModelSheetDialog';

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__fox_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

function loadInitial(): Project {
  const s = storage();
  if (!s) return createMkultraProject();
  try {
    const raw = s.getItem(STORAGE_KEY);
    return (raw && restoreProject(JSON.parse(raw))) || createMkultraProject();
  } catch {
    return createMkultraProject();
  }
}

export function App() {
  const [project, setProject] = useState<Project>(loadInitial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => (storage() ? 'saved' : 'unavailable'));
  const [selected, setSelected] = useState(0);
  const [theater, setTheater] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [musicBuffer, setMusicBuffer] = useState<AudioBuffer | null>(null);
  const [narrationFile, setNarrationFile] = useState<NarrationFile | null>(null);
  const [customMusic, setCustomMusic] = useState<NarrationFile | null>(null);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const engine = useRef(new AudioEngine()).current;
  const narrator = useRef(new SpeechNarrator()).current;

  // ---- Studio (neural) narrator: the voice pack for the current language + live-rendered edited lines.
  const lang: Lang = project.settings.language ?? 'en';
  const studio = studioVoiceFor(lang, project.settings.studioVoice?.[lang]);
  const voiceKey = `${lang}-${studio.id}`;
  const studioMode = project.settings.narrationMode === 'studio';
  const [pack, setPack] = useState<StudioPack | null>(null);
  const [packStatus, setPackStatus] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; error?: string }>({ state: 'idle' });
  const liveStore = useRef(new Map<string, Map<string, NonNullable<ReturnType<ReturnType<typeof studioTiming>['clip']>>>>());
  const [liveVersion, setLiveVersion] = useState(0);
  const [server, setServer] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');
  const [rendering, setRendering] = useState<string[]>([]);

  useEffect(() => {
    if (!studioMode) return;
    if (pack && `${pack.lang}-${pack.voice}` === voiceKey) return;
    const ac = new AbortController();
    setPack(null);
    setPackStatus({ state: 'loading' });
    loadStudioPack(lang, studio.id, ac.signal).then(
      (p) => {
        setPack(p);
        setPackStatus({ state: 'ready' });
      },
      (e) => !ac.signal.aborted && setPackStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) }),
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioMode, voiceKey]);

  const timing = useMemo(() => {
    if (!studioMode) return null;
    const p = pack && `${pack.lang}-${pack.voice}` === voiceKey ? pack : null;
    const live = liveStore.current.get(voiceKey) ?? new Map();
    return p || live.size ? studioTiming(p, live) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioMode, pack, voiceKey, liveVersion]);

  const timeline = useMemo(() => buildTimeline(project, undefined, timing), [project, timing]);
  const durationsKey = timeline.spans.map((s) => s.duration.toFixed(2)).join(',') + '|' + timeline.cues.map((c) => c.start.toFixed(2)).join(',');

  // Sentences the pack does not have (the user rewrote them).
  const sentences = useMemo(
    () => [...(hasHook(project) ? splitSentences(scriptFor(lang).hook.text) : []), ...project.scenes.flatMap((s) => splitSentences(s.narration))],
    [project, lang],
  );
  const missing = useMemo(() => (timing ? sentences.filter((x) => !timing.clip(x)) : []), [sentences, timing]);
  const studioTrack = useMemo<NarrationFile | null>(() => {
    if (!timing) return null;
    const buffer = renderStudioTrack(timeline, timing);
    return buffer ? { name: `Studio voice · ${studio.label}`, duration: buffer.duration, buffer } : null;
  }, [timeline, timing, studio.label]);

  // The local voice server is probed automatically only when the studio itself runs on this machine
  // (a public page asking for 127.0.0.1 would trigger a browser permission prompt).
  const probeServer = useCallback(async () => {
    setServer('checking');
    setServer((await probeVoiceServer()) ? 'online' : 'offline');
  }, []);
  useEffect(() => {
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) void probeServer();
  }, [probeServer]);

  // Render edited lines with the local server, one at a time, shortly after typing stops.
  useEffect(() => {
    if (!studioMode || server !== 'online' || packStatus.state === 'loading' || !missing.length) return;
    let alive = true;
    const id = window.setTimeout(async () => {
      const store = liveStore.current.get(voiceKey) ?? new Map();
      liveStore.current.set(voiceKey, store);
      for (const text of missing) {
        if (!alive) return;
        setRendering((r) => [...r, text]);
        try {
          store.set(text, await renderSentence(text, lang, studio.id, studio.kokoroLang, studio.speed));
          if (alive) setLiveVersion((v) => v + 1);
        } catch {
          if (alive) setServer('offline');
          return;
        } finally {
          setRendering((r) => r.filter((x) => x !== text));
        }
      }
    }, 900);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioMode, server, packStatus.state, missing.join('\n'), voiceKey]);

  const narrationTrack = studioMode ? studioTrack : project.settings.narrationMode === 'file' ? narrationFile : null;

  // A music track loaded by the user replaces the built-in score (looped, ducked under the voice).
  const fittedMusic = useMemo(() => (customMusic ? fitMusicTrack(customMusic.buffer, timeline) : null), [customMusic, timeline]);
  const activeMusic = fittedMusic ?? musicBuffer;
  const playback = usePlayback({ project, timeline, engine, narrator, musicBuffer: activeMusic, narrationFile: narrationTrack });
  const current = locate(timeline, playback.time).span.index;

  // ---- Persistence (debounced autosave).
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const s = storage();
    if (!s) {
      setSaveStatus('unavailable');
      return;
    }
    setSaveStatus('saving');
    const id = window.setTimeout(() => {
      try {
        s.setItem(STORAGE_KEY, JSON.stringify(project));
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [project]);

  // ---- Procedural score, regenerated when scene durations change.
  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(() => {
      renderAmbience(timeline).then(
        (b) => alive && setMusicBuffer(b),
        () => alive && setMusicBuffer(null),
      );
    }, 600);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationsKey]);

  useEffect(() => {
    setSpeechLanguage(lang);
    return watchVoices(setVoices, lang);
  }, [lang]);

  // ---- Editing helpers.
  const updateScene = useCallback((index: number, patch: Partial<Scene>) => {
    setProject((p) => ({ ...p, scenes: p.scenes.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }, []);
  const updateSettings = useCallback((patch: Partial<ProjectSettings>) => {
    setProject((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  }, []);
  const changeLanguage = useCallback((next: Lang) => {
    narrator.cancel();
    setProject((p) => switchLanguage(p, next));
  }, [narrator]);
  const updateStyle = useCallback((patch: Partial<SubtitleStyle>) => {
    setProject((p) => ({ ...p, settings: { ...p.settings, subtitles: { ...p.settings.subtitles, ...patch } } }));
  }, []);

  const selectScene = useCallback(
    (i: number) => {
      setSelected(i);
      playback.seek(timeline.spans[i].start + 0.01);
    },
    [playback, timeline],
  );

  const resetProject = () => {
    playback.pause();
    setProject(createMkultraProject());
    setSelected(0);
    playback.seek(0);
  };

  const loadNarration = async (file: File) => {
    setNarrationError(null);
    try {
      setNarrationFile(await engine.decodeFile(file));
    } catch (e) {
      setNarrationError(`Could not decode “${file.name}”: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const loadMusic = async (file: File) => {
    setNarrationError(null);
    try {
      setCustomMusic(await engine.decodeFile(file));
    } catch (e) {
      setNarrationError(`Could not decode “${file.name}”: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const testVoice = () => {
    narrator.cancel();
    if (studioMode && timing) {
      const first = splitSentences(project.scenes[selected].narration).find((x) => timing.clip(x));
      const c = first ? timing.clip(first) : undefined;
      if (c) {
        playback.pause();
        engine.preview(c.buffer, c.offset, c.duration);
        return;
      }
    }
    narrator.speak(splitSentences(project.scenes[selected].narration)[0] ?? '', project.settings.voiceURI, project.settings.speechRate);
  };

  const replayScene = (i: number) => {
    setSelected(i);
    playback.seek(timeline.spans[i].start + 0.01);
    playback.play();
  };

  // ---- Keyboard: space toggles playback (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        playback.toggle();
      } else if (e.key === 'Escape') {
        setTheater(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback]);

  const s = project.settings;
  const audioLabel = [
    s.narrationMode === 'studio'
      ? packStatus.state === 'ready'
        ? `Voice: studio · ${studio.label.split(' — ')[0]}`
        : packStatus.state === 'error'
          ? 'Voice: studio pack missing'
          : 'Voice: loading studio voice…'
      : s.narrationMode === 'speech'
        ? speechSupported()
          ? 'Voice: browser speech'
          : 'Voice: unavailable'
        : s.narrationMode === 'file'
          ? narrationFile
            ? 'Voice: audio file'
            : 'Voice: no file loaded'
          : 'Voice: off',
    s.music ? (customMusic ? 'music: your track' : musicBuffer ? 'score on' : 'score loading…') : 'music off',
  ].join(' · ');

  return (
    <div className={`studio ${theater ? 'theater' : ''}`}>
      <Header
        project={project}
        saveStatus={saveStatus}
        theater={theater}
        onToggleTheater={() => {
          const next = !theater;
          setTheater(next);
          if (next) {
            playback.seek(0);
            playback.play();
          }
        }}
        onExport={() => {
          playback.pause();
          setShowExport(true);
        }}
        onSources={() => setShowSources(true)}
        onModelSheet={() => {
          playback.pause();
          setShowSheet(true);
        }}
        onReset={resetProject}
      />
      <SceneList project={project} timeline={timeline} selected={selected} current={current} onSelect={selectScene} />
      <main className="center">
        <PreviewPlayer project={project} timeline={timeline} playback={playback} audioLabel={audioLabel} />
      </main>
      <PropertiesPanel
        project={project}
        timeline={timeline}
        selected={selected}
        voices={voices}
        speechAvailable={speechSupported()}
        narrationFile={narrationFile}
        narrationError={narrationError}
        onSceneChange={updateScene}
        onSettingsChange={updateSettings}
        onStyleChange={updateStyle}
        onSeek={playback.seek}
        onReplayScene={replayScene}
        onTestVoice={testVoice}
        onLoadNarration={loadNarration}
        onClearNarration={() => setNarrationFile(null)}
        customMusic={customMusic}
        onLoadMusic={loadMusic}
        onClearMusic={() => setCustomMusic(null)}
        onShowSources={() => setShowSources(true)}
        onLanguageChange={changeLanguage}
        studio={{
          voice: studio.id,
          status: packStatus.state,
          error: packStatus.error,
          missing: missing.length,
          rendering: rendering.length,
          server,
        }}
        onProbeServer={probeServer}
      />
      <Timeline timeline={timeline} time={playback.time} selected={selected} onSeek={playback.seek} onSelect={setSelected} />

      {showExport && (
        <ExportDialog
          project={project}
          timeline={timeline}
          musicBuffer={activeMusic}
          customMusic={customMusic?.buffer ?? null}
          narrationFile={narrationTrack}
          voice={timing}
          studioTrackFor={timing ? (tl) => renderStudioTrack(tl, timing) : undefined}
          missingVoice={missing.length}
          onClose={() => setShowExport(false)}
          onAspectChange={(aspect) => updateSettings({ aspect })}
        />
      )}
      {showSources && <SourcesPanel project={project} onClose={() => setShowSources(false)} />}
      {showSheet && <ModelSheetDialog onClose={() => setShowSheet(false)} />}
    </div>
  );
}
