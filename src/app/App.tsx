import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectSettings, Scene, SubtitleStyle } from '../types';
import { switchLanguage } from '../data/project';
import { loadInitialProject, saveProject, storage } from '../data/library';
import { projectHook } from '../data/projectText';
import { buildTimeline, hasHook, locate, splitSentences } from '../animation/timeline';
import { fitMusicTrack, renderAmbience } from '../audio/ambience';
import { AudioEngine, type NarrationFile } from '../audio/narration';
import { SpeechNarrator, setSpeechLanguage, speechSupported, watchVoices } from '../audio/speechSynthesis';
import { loadStudioPack, probeVoiceServer, renderSentence, renderStudioTrack, studioTiming, type StudioPack } from '../audio/studioVoice';
import { studioVoiceFor } from '../audio/studioVoices';
import type { Lang } from '../i18n/languages';
import { usePlayback } from './usePlayback';
import type { SaveStatus } from '../components/Header';
import { PreviewPlayer } from '../components/PreviewPlayer';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { ExportDialog } from '../components/ExportDialog';
import { SourcesPanel } from '../components/SourcesPanel';
import { ModelSheetDialog } from '../components/ModelSheetDialog';
import { useHistory } from '../editor/useHistory';
import { TopBar, type Page } from '../editor/TopBar';
import { LeftPanel } from '../editor/LeftPanel';
import { TimelineEditor } from '../editor/TimelineEditor';
import { Inspector, withBeats } from '../editor/Inspector';
import { MediaPage } from '../editor/MediaPage';
import { AiPanel } from '../editor/AiPanel';
import { foxOf, foxTrack, setFoxTrack, updateFox, updateScene, updateShot, updateSpec, type Selection } from '../editor/model';
import { sceneBeats } from '../data/projectText';
import { useProjectMedia } from '../media/useMedia';
import { ShortcutsDialog } from '../editor/ShortcutsDialog';
import { FoxMonitor } from '../editor/FoxMonitor';
import type { FoxDebug } from '../character/AgentFox';
import { uniqueId, updateElement } from '../editor/model';
import { setNumFor } from '../editor/StageOverlay';
import type { SceneElement } from '../scene/spec';

const FRAME = 1 / 30;

export function App() {
  const hist = useHistory<Project>(loadInitialProject);
  const project = hist.value;
  const setProject = hist.set;
  const [page, setPage] = useState<Page>('edit');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => (storage() ? 'saved' : 'unavailable'));
  const [savedTick, setSavedTick] = useState(0);
  const [selection, setSelectionRaw] = useState<Selection>({ kind: 'scene', scene: 0 });
  const [theater, setTheater] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [musicBuffer, setMusicBuffer] = useState<AudioBuffer | null>(null);
  const [narrationFile, setNarrationFile] = useState<NarrationFile | null>(null);
  const [customMusic, setCustomMusic] = useState<NarrationFile | null>(null);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Keep the selection inside the project (scenes can be deleted, undo can remove items).
  const selected = Math.min(selection.scene, project.scenes.length - 1);
  const sel: Selection = selected === selection.scene ? selection : { kind: 'scene', scene: selected };
  const setSelection = useCallback((s: Selection) => setSelectionRaw(s), []);

  const [showKeys, setShowKeys] = useState(false);
  const [foxLive, setFoxLive] = useState<FoxDebug | null>(null);
  /** Copied element (Ctrl+C), pasted into the selected data scene with Ctrl+V. */
  const clipboard = useRef<SceneElement | null>(null);
  useProjectMedia(project);

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
  const sentences = useMemo(() => {
    const hook = hasHook(project) ? projectHook(project, lang) : null;
    return [...(hook ? splitSentences(hook.text) : []), ...project.scenes.flatMap((s) => splitSentences(s.narration))];
  }, [project, lang]);
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
    if (!studioMode || studio.packOnly || server !== 'online' || packStatus.state === 'loading' || !missing.length) return;
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

  // ---- Persistence (debounced autosave into the project library).
  const firstSave = useRef(true);
  const persist = useCallback((p: Project) => {
    try {
      saveProject(p);
      setSaveStatus('saved');
      setSavedTick((n) => n + 1);
    } catch {
      setSaveStatus(storage() ? 'error' : 'unavailable');
    }
  }, []);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    if (!storage()) return setSaveStatus('unavailable');
    setSaveStatus('saving');
    const id = window.setTimeout(() => persist(project), 500);
    return () => window.clearTimeout(id);
  }, [project, persist]);
  // Reloading or closing the tab inside the autosave delay must not lose the last edit: save now.
  const latest = useRef(project);
  latest.current = project;
  useEffect(() => {
    const flush = () => {
      try {
        if (storage()) saveProject(latest.current);
      } catch {
        /* storage full: the header already says so */
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  /** Switch to another episode: save this one now, then load the other with a fresh history. */
  const openProject = useCallback(
    (p: Project) => {
      playback.pause();
      if (storage()) persist(project);
      hist.reset(p);
      persist(p);
      setSelectionRaw({ kind: 'scene', scene: 0 });
      setNarrationFile(null);
      playback.seek(0);
      setPage('edit');
    },
    [playback, persist, project, hist],
  );

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
  const change = useCallback((fn: (p: Project) => Project, key?: string) => setProject(fn, key), [setProject]);
  const changeScene = useCallback(
    (index: number, patch: Partial<Scene>) => setProject((p) => updateScene(p, index, patch), `scene:${index}:${Object.keys(patch).join(',')}`),
    [setProject],
  );
  const updateSettings = useCallback(
    (patch: Partial<ProjectSettings>) => setProject((p) => ({ ...p, settings: { ...p.settings, ...patch } }), `settings:${Object.keys(patch).join(',')}`),
    [setProject],
  );
  const changeLanguage = useCallback(
    (next: Lang) => {
      narrator.cancel();
      setProject((p) => switchLanguage(p, next));
    },
    [narrator, setProject],
  );
  const updateStyle = useCallback(
    (patch: Partial<SubtitleStyle>) => setProject((p) => ({ ...p, settings: { ...p.settings, subtitles: { ...p.settings.subtitles, ...patch } } }), 'subtitles'),
    [setProject],
  );

  const selectScene = useCallback(
    (i: number) => {
      setSelectionRaw({ kind: 'scene', scene: i });
      playback.seek(timeline.spans[i].start + 0.01);
    },
    [playback, timeline],
  );

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
    setSelectionRaw({ kind: 'scene', scene: i });
    playback.seek(timeline.spans[i].start + 0.01);
    playback.play();
  };

  /** Delete whatever is selected (never a whole scene from the keyboard). */
  const deleteSelected = useCallback(() => {
    const s = sel;
    if (s.kind === 'element') setProject((p) => updateSpec(p, s.scene, (spec) => ({ ...spec, elements: spec.elements.filter((e) => e.id !== s.id) })));
    else if (s.kind === 'shot' && s.index > 0) setProject((p) => updateShot(p, s.scene, s.index, null));
    else if (s.kind === 'action') setProject((p) => updateFox(p, s.scene, (f) => ({ ...f, actions: (f.actions ?? []).filter((_, i) => i !== s.index) })));
    else if (s.kind === 'key') {
      const fox = foxOf(project.scenes[s.scene]?.spec);
      if (fox) setProject((p) => updateFox(p, s.scene, (f) => setFoxTrack(f, s.track, foxTrack(fox, s.track).filter((_, i) => i !== s.index))));
    } else if (s.kind === 'beat') {
      setProject((p) => updateScene(p, s.scene, (sc) => withBeats(sc, p.settings.language, sceneBeats(sc, p.settings.language).filter((_, i) => i !== s.index))));
    } else return;
    setSelectionRaw({ kind: 'scene', scene: s.scene });
  }, [sel, setProject, project.scenes]);

  /** Paste (or duplicate) an element into a data scene: new id, in front of everything but Agent Fox. */
  const pasteElement = useCallback(
    (el: SceneElement, scene: number) => {
      const spec = project.scenes[scene]?.spec;
      if (!spec || el.type === 'fox') return;
      const id = uniqueId(spec, el.id.replace(/-\d+$/, ''));
      setProject((p) =>
        updateSpec(p, scene, (sp) => {
          const els = [...sp.elements];
          const fox = els.findIndex((e) => e.type === 'fox');
          els.splice(fox >= 0 ? fox : els.length, 0, { ...structuredClone(el), id });
          return { ...sp, elements: els };
        }),
      );
      setSelectionRaw({ kind: 'element', scene, id });
    },
    [project.scenes, setProject],
  );

  // ---- Keyboard (outside text fields): Resolve-style transport and editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (el.closest('input, textarea, [contenteditable]')) return; // native text undo
        e.preventDefault();
        if (e.shiftKey) hist.redo();
        else hist.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (el.closest('input, textarea, [contenteditable]')) return;
        e.preventDefault();
        hist.redo();
        return;
      }
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      if (mod && ['c', 'v', 'd'].includes(e.key.toLowerCase())) {
        const s = sel;
        const spec = project.scenes[s.scene]?.spec;
        const cur = s.kind === 'element' ? spec?.elements.find((x) => x.id === s.id) : undefined;
        const k = e.key.toLowerCase();
        if (k === 'c' && cur && cur.type !== 'fox') clipboard.current = structuredClone(cur);
        else if (k === 'v' && clipboard.current) pasteElement(clipboard.current, s.scene);
        else if (k === 'd' && cur) pasteElement(cur, s.scene);
        else return;
        e.preventDefault();
        return;
      }
      // Alt + arrows: nudge the selected element (Shift = bigger steps), in the format on screen.
      if (e.altKey && e.key.startsWith('Arrow') && sel.kind === 'element') {
        e.preventDefault();
        const st = e.shiftKey ? 0.02 : 0.004;
        const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0;
        const dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
        const V = project.settings.aspect === '9:16';
        const s0 = sel;
        setProject(
          (p) =>
            updateElement(p, s0.scene, s0.id, (el) => {
              const cur = (n: unknown) => (typeof n === 'number' ? n : n && typeof n === 'object' ? (V ? (n as { v: number }).v : (n as { h: number }).h) : 0);
              return { ...el, x: setNumFor(el.x, V, cur(el.x) + dx), y: setNumFor(el.y, V, cur(el.y) + dy) };
            }),
          `nudge:${s0.id}`,
        );
        return;
      }
      const t = playback.time;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          playback.toggle();
          break;
        case 'k':
        case 'K':
          playback.pause();
          break;
        case 'l':
        case 'L':
          playback.play();
          break;
        case 'j':
        case 'J':
          playback.seek(t - 2);
          break;
        case 'ArrowRight':
          e.preventDefault();
          playback.seek(t + (e.shiftKey ? 1 : FRAME));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          playback.seek(t - (e.shiftKey ? 1 : FRAME));
          break;
        case 'Home':
          playback.seek(0);
          break;
        case 'End':
          playback.seek(timeline.total);
          break;
        case 'Delete':
        case 'Backspace':
          deleteSelected();
          break;
        case 'Escape':
          setTheater(false);
          setShowKeys(false);
          break;
        case '?':
          setShowKeys((v) => !v);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback, hist, timeline.total, deleteSelected, sel, project.scenes, project.settings.aspect, pasteElement, setProject]);

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

  const exportProps = {
    project,
    timeline,
    musicBuffer: activeMusic,
    customMusic: customMusic?.buffer ?? null,
    narrationFile: narrationTrack,
    voice: timing,
    studioTrackFor: timing ? (tl: typeof timeline) => renderStudioTrack(tl, timing) : undefined,
    missingVoice: missing.length,
    onAspectChange: (aspect: ProjectSettings['aspect']) => updateSettings({ aspect }),
  };

  return (
    <div className={`studio editor page-${page} ${theater ? 'theater' : ''}`}>
      <TopBar
        project={project}
        page={page}
        saveStatus={saveStatus}
        canUndo={hist.canUndo}
        canRedo={hist.canRedo}
        theater={theater}
        onPage={(pg) => {
          if (pg !== 'edit') playback.pause();
          setPage(pg);
        }}
        onUndo={hist.undo}
        onRedo={hist.redo}
        onRename={(t) => setProject((p) => ({ ...p, episodeTitle: t }), 'rename')}
        onToggleTheater={() => {
          const next = !theater;
          setTheater(next);
          setPage('edit');
          if (next) {
            playback.seek(0);
            playback.play();
          }
        }}
        onSources={() => setShowSources(true)}
        onModelSheet={() => {
          playback.pause();
          setShowSheet(true);
        }}
      />

      {page === 'media' && <MediaPage project={project} onOpen={openProject} savedTick={savedTick} onChange={change} />}

      {page === 'deliver' && (
        <main className="deliver-page">
          <ExportDialog {...exportProps} inline onClose={() => setPage('edit')} />
        </main>
      )}

      {page === 'edit' && (
        <>
          <LeftPanel
            project={project}
            timeline={timeline}
            time={playback.time}
            selection={sel}
            current={current}
            onSelect={setSelection}
            onSelectScene={selectScene}
            onChange={change}
          />
          <main className="center">
            <PreviewPlayer
              project={project}
              timeline={timeline}
              playback={playback}
              audioLabel={audioLabel}
              editing={{ selection: sel, onSelect: setSelection, onChange: change, onFox: setFoxLive }}
            />
          </main>
          <div className="right-col">
          <AiPanel project={project} timeline={timeline} scene={selected} onChange={change} onUndo={hist.undo} />
          <FoxMonitor fox={foxLive} />
          {sel.kind === 'scene' ? (
            <PropertiesPanel
              project={project}
              timeline={timeline}
              selected={selected}
              voices={voices}
              speechAvailable={speechSupported()}
              narrationFile={narrationFile}
              narrationError={narrationError}
              onSceneChange={changeScene}
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
          ) : (
            <Inspector project={project} timeline={timeline} time={playback.time} selection={sel} onSelect={setSelection} onChange={change} onSeek={playback.seek} />
          )}
          </div>
          <TimelineEditor
            project={project}
            timeline={timeline}
            time={playback.time}
            selection={sel}
            onSeek={playback.seek}
            onSelect={setSelection}
            onChange={change}
            musicOn={s.music}
          />
        </>
      )}

      {showSources && <SourcesPanel project={project} onClose={() => setShowSources(false)} />}
      {showSheet && <ModelSheetDialog onClose={() => setShowSheet(false)} />}
      {showKeys && <ShortcutsDialog onClose={() => setShowKeys(false)} />}
    </div>
  );
}
