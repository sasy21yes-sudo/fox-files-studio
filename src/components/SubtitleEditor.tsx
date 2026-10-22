import type { Project, Scene, SubtitleStyle } from '../types';
import { countWords, formatTime, type Timeline } from '../animation/timeline';
import { scriptFor } from '../i18n/scripts';

interface Props {
  project: Project;
  timeline: Timeline;
  sceneIndex: number;
  onSceneChange(patch: Partial<Scene>): void;
  onStyleChange(patch: Partial<SubtitleStyle>): void;
  onSeek(t: number): void;
}

/**
 * Edits the narration of the selected scene. The text is split into subtitle
 * cues automatically; the same text is what speech synthesis reads aloud.
 */
export function SubtitleEditor({ project, timeline, sceneIndex, onSceneChange, onStyleChange, onSeek }: Props) {
  const scene = project.scenes[sceneIndex];
  const span = timeline.spans[sceneIndex];
  const cues = timeline.cues.filter((c) => c.sceneIndex === sceneIndex);
  const style = project.settings.subtitles;
  const original = scriptFor(project.settings.language).scenes[scene.id];
  const edited = original && (original.narration !== scene.narration || original.keywords.join('|') !== scene.keywords.join('|'));

  return (
    <div className="subtitle-editor">
      <label className="field">
        <span className="field-label">
          Narration &amp; subtitles <span className="muted">· {countWords(scene.narration)} words</span>
        </span>
        <textarea
          value={scene.narration}
          rows={6}
          onChange={(e) => onSceneChange({ narration: e.target.value })}
          spellCheck
          aria-describedby="narration-help"
        />
      </label>
      <p id="narration-help" className="help">
        Sentences become subtitle cues. Keep edits factual — the Sources panel lists what each scene can support.
      </p>

      {span.extended && (
        <p className="notice">
          The studio voice needs {span.estimatedSpeech.toFixed(1)} s here, so this scene plays for {span.duration.toFixed(1)} s instead of{' '}
          {scene.duration.toFixed(1)} s. The animation stretches to match.
        </p>
      )}

      {span.overflow && (
        <p className="notice warn">
          At the current speech rate this narration needs about {span.estimatedSpeech.toFixed(1)} s, more than the scene allows. Cues are
          compressed to fit; lengthen the scene or shorten the text.
        </p>
      )}

      <label className="field">
        <span className="field-label">Highlighted keywords</span>
        <input
          type="text"
          value={scene.keywords.join(', ')}
          onChange={(e) =>
            onSceneChange({
              keywords: e.target.value
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean),
            })
          }
          placeholder="comma, separated, phrases"
        />
      </label>

      <div className="cue-list" aria-label="Subtitle cues for this scene">
        <div className="cue-list-head">
          <span>Cues</span>
          {cues.length > 0 && cues.every((c) => c.timing === 'exact') ? (
            <span className="timing-tag" title="Measured from the studio voice: each cue starts and ends where the voice does">
              timed from the voice
            </span>
          ) : (
            <span className="timing-tag" title="Derived from word counts and the speech rate, not measured from an audio file">
              estimated timing
            </span>
          )}
        </div>
        {cues.map((c) => (
          <button key={c.id} className="cue-row" onClick={() => onSeek(c.start + 0.01)}>
            <span className="cue-time">
              {formatTime(c.start)}–{formatTime(c.end)}
            </span>
            <span className="cue-text">{c.text}</span>
          </button>
        ))}
        {!cues.length && <p className="help">No narration in this scene.</p>}
      </div>

      {edited && original && (
        <button className="btn small ghost" onClick={() => onSceneChange({ narration: original.narration, keywords: [...original.keywords] })}>
          Restore original script for this scene
        </button>
      )}

      <h4 className="sub-head">Subtitle style</h4>
      <label className="check">
        <input type="checkbox" checked={style.enabled} onChange={(e) => onStyleChange({ enabled: e.target.checked })} />
        Show subtitles (burned into preview and export)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={style.highlightKeywords}
          onChange={(e) => onStyleChange({ highlightKeywords: e.target.checked })}
        />
        Highlight keywords
      </label>
      <label className="field">
        <span className="field-label">
          Font size <span className="muted">{Math.round(style.fontScale * 100)}%</span>
        </span>
        <input
          type="range"
          min={0.7}
          max={1.6}
          step={0.05}
          value={style.fontScale}
          onChange={(e) => onStyleChange({ fontScale: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span className="field-label">
          Vertical position <span className="muted">{style.position < 0.05 ? 'bottom of safe area' : `${Math.round(style.position * 100)}% up`}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={style.position}
          onChange={(e) => onStyleChange({ position: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
