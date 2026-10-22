import { useRef, useState, type ReactNode } from 'react';
import type { AspectRatio, NarrationMode, Project, ProjectSettings, Scene, SubtitleStyle, TransitionType } from '../types';
import type { Timeline } from '../animation/timeline';
import { formatTime } from '../animation/timeline';
import { MAX_SCENE_DURATION, MIN_SCENE_DURATION } from '../data/mkultraProject';
import { sourceById } from '../data/sources';
import { TRANSITION_LABELS } from '../effects/transitions';
import type { NarrationFile } from '../audio/narration';
import { SubtitleEditor } from './SubtitleEditor';
import { LANGUAGES, type Lang } from '../i18n/languages';
import { STUDIO_VOICES, studioVoiceFor } from '../audio/studioVoices';

export interface StudioStatus {
  voice: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  /** Sentences not in the voice pack (rewritten lines). */
  missing: number;
  /** Sentences being rendered by the local voice server right now. */
  rendering: number;
  server: 'unknown' | 'checking' | 'online' | 'offline';
}

interface Props {
  project: Project;
  timeline: Timeline;
  selected: number;
  voices: SpeechSynthesisVoice[];
  speechAvailable: boolean;
  narrationFile: NarrationFile | null;
  narrationError: string | null;
  onSceneChange(index: number, patch: Partial<Scene>): void;
  onSettingsChange(patch: Partial<ProjectSettings>): void;
  onStyleChange(patch: Partial<SubtitleStyle>): void;
  onSeek(t: number): void;
  onReplayScene(index: number): void;
  onTestVoice(): void;
  onLoadNarration(file: File): void;
  onClearNarration(): void;
  customMusic: NarrationFile | null;
  onLoadMusic(file: File): void;
  onClearMusic(): void;
  onShowSources(): void;
  onLanguageChange(lang: Lang): void;
  studio: StudioStatus;
  onProbeServer(): void;
}

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`prop-section ${open ? 'open' : ''}`}>
      <button className="prop-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        <span className="chev" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <div className="prop-body">{children}</div>}
    </section>
  );
}

export function PropertiesPanel(p: Props) {
  const { project, timeline, selected } = p;
  const scene = project.scenes[selected];
  const span = timeline.spans[selected];
  const s = project.settings;
  const fileInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  const setAspect = (aspect: AspectRatio) => p.onSettingsChange({ aspect });

  return (
    <aside className="properties" aria-label="Properties">
      <Section title={`Scene ${selected + 1} · ${scene.title}`}>
        <p className="help">{scene.summary}</p>
        <label className="field">
          <span className="field-label">
            Duration <span className="muted">{scene.duration.toFixed(1)} s · starts {formatTime(span.start)}</span>
          </span>
          <div className="row">
            <input
              type="range"
              min={MIN_SCENE_DURATION}
              max={MAX_SCENE_DURATION}
              step={0.5}
              value={scene.duration}
              onChange={(e) => p.onSceneChange(selected, { duration: Number(e.target.value) })}
            />
            <input
              type="number"
              className="num"
              min={MIN_SCENE_DURATION}
              max={MAX_SCENE_DURATION}
              step={0.5}
              value={scene.duration}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) p.onSceneChange(selected, { duration: Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, v)) });
              }}
              aria-label="Duration in seconds"
            />
          </div>
        </label>
        <p className="help">
          The choreography (authored for {scene.authoredDuration} s) stretches to fit, so every beat still happens.
        </p>
        <label className="field">
          <span className="field-label">Transition in</span>
          <select value={scene.transition} onChange={(e) => p.onSceneChange(selected, { transition: e.target.value as TransitionType })}>
            {(Object.keys(TRANSITION_LABELS) as TransitionType[]).map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {p.project.settings.chapterCards !== false && (
          <label className="check">
            <input type="checkbox" checked={scene.chapterCard !== false} onChange={(e) => p.onSceneChange(selected, { chapterCard: e.target.checked ? undefined : false })} />
            Chapter card on this scene
          </label>
        )}
        <div className="scene-sources">
          <span className="field-label">Supported by</span>
          <ul>
            {scene.sourceIds.map((id) => {
              const src = sourceById(id);
              return src ? (
                <li key={id}>
                  <a href={src.url} target="_blank" rel="noreferrer">
                    {src.title.split(' — ')[0]}
                  </a>{' '}
                  <span className="muted">({src.date})</span>
                </li>
              ) : null;
            })}
          </ul>
          <button className="btn small ghost" onClick={p.onShowSources}>
            Open Sources panel
          </button>
        </div>
      </Section>

      <Section title="Subtitles">
        <SubtitleEditor
          project={project}
          timeline={timeline}
          sceneIndex={selected}
          onSceneChange={(patch) => p.onSceneChange(selected, patch)}
          onStyleChange={p.onStyleChange}
          onSeek={p.onSeek}
        />
      </Section>

      <Section title="Format & look">
        <div className="segmented" role="radiogroup" aria-label="Aspect ratio">
          {(['16:9', '9:16'] as AspectRatio[]).map((a) => (
            <button key={a} role="radio" aria-checked={s.aspect === a} className={s.aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>
              <span className={`ratio-icon r${a.replace(':', '')}`} aria-hidden="true" />
              {a} <span className="muted">{a === '16:9' ? '1920×1080' : '1080×1920'}</span>
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={s.characterStyle !== 'vector'}
            onChange={(e) => p.onSettingsChange({ characterStyle: e.target.checked ? 'painted' : 'vector' })}
          />
          Painted Agent Fox (off = vector rig)
        </label>
        <label className="check">
          <input type="checkbox" checked={s.filmGrain} onChange={(e) => p.onSettingsChange({ filmGrain: e.target.checked })} />
          Film grain, dust &amp; scratches
        </label>
        <label className="check">
          <input type="checkbox" checked={s.chapterCards !== false} onChange={(e) => p.onSettingsChange({ chapterCards: e.target.checked })} />
          1930s chapter cards between scenes
        </label>
        <label className="check">
          <input type="checkbox" checked={s.shortHook !== false} onChange={(e) => p.onSettingsChange({ shortHook: e.target.checked })} />
          Hook at the start of the 9:16 Short
        </label>
        <label className="check">
          <input type="checkbox" checked={s.showSafeArea} onChange={(e) => p.onSettingsChange({ showSafeArea: e.target.checked })} />
          Show subtitle safe area (preview only)
        </label>
        <label className="field">
          <span className="field-label">
            Preview speed <span className="muted">{s.previewSpeed}× · export always renders at 1×</span>
          </span>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.25}
            value={s.previewSpeed}
            onChange={(e) => p.onSettingsChange({ previewSpeed: Number(e.target.value) })}
          />
        </label>
      </Section>

      <Section title="Narration & audio">
        <label className="field">
          <span className="field-label">Language — narration, subtitles, pop-ups &amp; on-screen labels</span>
          <select value={s.language} onChange={(e) => p.onLanguageChange(e.target.value as Lang)}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented four" role="radiogroup" aria-label="Narration source">
          {(
            [
              ['studio', 'Studio voice'],
              ['speech', 'Browser voice'],
              ['file', 'Audio file'],
              ['off', 'Off'],
            ] as [NarrationMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              role="radio"
              aria-checked={s.narrationMode === mode}
              className={s.narrationMode === mode ? 'on' : ''}
              onClick={() => p.onSettingsChange({ narrationMode: mode })}
            >
              {label}
            </button>
          ))}
        </div>

        {s.narrationMode === 'studio' && (
          <>
            <label className="field">
              <span className="field-label">Narrator</span>
              <select
                value={studioVoiceFor(s.language, s.studioVoice?.[s.language]).id}
                onChange={(e) => p.onSettingsChange({ studioVoice: { ...s.studioVoice, [s.language]: e.target.value } })}
              >
                {STUDIO_VOICES[s.language].map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            {p.studio.status === 'loading' && <p className="notice">Loading the voice…</p>}
            {p.studio.status === 'error' && (
              <p className="notice warn">
                The voice pack could not be loaded ({p.studio.error}). The browser voice reads the narration meanwhile. Rebuild it with{' '}
                <code>python tools/render_voice.py</code>.
              </p>
            )}
            {p.studio.status === 'ready' && (
              <p className="notice ok">
                Neural narrator (Kokoro-82M, rendered offline). Subtitles, pop-ups and lip sync follow the real voice, and it is mixed into the
                exported video.
              </p>
            )}
            {p.studio.missing > 0 && (
              <div className="notice warn">
                <p>
                  {p.studio.missing} rewritten {p.studio.missing === 1 ? 'line is' : 'lines are'} not in the voice pack
                  {p.studio.server === 'online'
                    ? p.studio.rendering
                      ? ` — rendering with your local voice server (${p.studio.rendering} left)…`
                      : ' — rendering with your local voice server…'
                    : '. The browser voice reads them in the preview; the export leaves them silent.'}
                </p>
                {p.studio.server !== 'online' && (
                  <p>
                    To voice them with the same narrator, run <code>python tools/voice_server.py</code> on this computer, then{' '}
                    <button className="btn small ghost" disabled={p.studio.server === 'checking'} onClick={p.onProbeServer}>
                      {p.studio.server === 'checking' ? 'checking…' : 'connect'}
                    </button>
                  </p>
                )}
              </div>
            )}
            <div className="row gap">
              <button className="btn small" onClick={p.onTestVoice}>
                Hear this scene's voice
              </button>
              <button className="btn small" onClick={() => p.onReplayScene(selected)}>
                Replay scene {selected + 1}
              </button>
            </div>
          </>
        )}

        {s.narrationMode === 'speech' && (
          <>
            {!p.speechAvailable && <p className="notice warn">This browser has no speech synthesis. Subtitles still play.</p>}
            {p.speechAvailable && (
              <>
                <label className="field">
                  <span className="field-label">
                    {LANGUAGES.find((l) => l.id === s.language)?.name} voice ({p.voices.length} found)
                  </span>
                  <select value={s.voiceURI ?? ''} onChange={(e) => p.onSettingsChange({ voiceURI: e.target.value || null })}>
                    <option value="">System default</option>
                    {p.voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} — {v.lang}
                        {v.localService ? '' : ' (online)'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">
                    Speech rate <span className="muted">{s.speechRate.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={0.7}
                    max={1.3}
                    step={0.05}
                    value={s.speechRate}
                    onChange={(e) => p.onSettingsChange({ speechRate: Number(e.target.value) })}
                  />
                </label>
                <div className="row gap">
                  <button className="btn small" onClick={p.onTestVoice}>
                    Test voice
                  </button>
                  <button className="btn small" onClick={() => p.onReplayScene(selected)}>
                    Replay scene {selected + 1} narration
                  </button>
                </div>
              </>
            )}
            <p className="notice">
              Browser speech synthesis sounds different on every device and browser. Each subtitle cue is spoken when playback reaches it, so
              sync is approximate — cue level, not word-perfect. It plays in the preview only: it cannot be recorded into an exported file.
            </p>
          </>
        )}

        {s.narrationMode === 'file' && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) p.onLoadNarration(f);
                e.target.value = '';
              }}
            />
            {p.narrationFile ? (
              <div className="file-chip">
                <span>
                  {p.narrationFile.name} · {p.narrationFile.duration.toFixed(1)} s
                </span>
                <button className="btn small ghost" onClick={p.onClearNarration}>
                  Remove
                </button>
              </div>
            ) : (
              <button className="btn small" onClick={() => fileInput.current?.click()}>
                Load narration audio…
              </button>
            )}
            {p.narrationError && <p className="notice warn">{p.narrationError}</p>}
            {p.narrationFile && Math.abs(p.narrationFile.duration - timeline.total) > 3 && (
              <p className="notice warn">
                The file lasts {p.narrationFile.duration.toFixed(1)} s but the timeline is {timeline.total.toFixed(1)} s. Adjust scene durations
                so the voice lines up.
              </p>
            )}
            <p className="notice">
              No narration recording ships with this demo. Load a recording you have the rights to use; it starts at 0:00, plays in sync and is
              mixed into the export. Subtitle timing stays estimated — it is not derived from your file.
            </p>
          </>
        )}

        <h4 className="sub-head">Score</h4>
        <label className="check">
          <input type="checkbox" checked={s.music} onChange={(e) => p.onSettingsChange({ music: e.target.checked })} />
          Music on (built-in 1930s hot-jazz score, ducked under the voice)
        </label>
        <input
          ref={musicInput}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onLoadMusic(f);
            e.target.value = '';
          }}
        />
        {p.customMusic ? (
          <div className="file-chip">
            <span>
              ♪ {p.customMusic.name} · {p.customMusic.duration.toFixed(1)} s (looped)
            </span>
            <button className="btn small ghost" onClick={p.onClearMusic}>
              Use built-in score
            </button>
          </div>
        ) : (
          <button className="btn small" onClick={() => musicInput.current?.click()}>
            Use my own music track…
          </button>
        )}
        <p className="notice">
          Your track replaces the score: it loops to the episode length and drops under every narration line. Use music you are allowed to
          monetize — e.g. the YouTube Audio Library (YouTube Studio → Audio Library, check each track's licence line).
        </p>
        <label className="field">
          <span className="field-label">
            Score volume <span className="muted">{Math.round(s.musicVolume * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.musicVolume}
            disabled={!s.music}
            onChange={(e) => p.onSettingsChange({ musicVolume: Number(e.target.value) })}
          />
        </label>
      </Section>
    </aside>
  );
}
