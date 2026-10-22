import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExportMethod, ExportResult, ExportSettings, Project } from '../types';
import { buildTimeline, formatTime, toSRT, toVTT, type Timeline, type VoiceTiming } from '../animation/timeline';
import { fitMusicTrack, renderAmbience } from '../audio/ambience';
import { buildPublishingKit } from '../export/publishingKit';
import { EXPORT_FPS, EXPORT_SIZES, detectCapabilities, type Capabilities } from '../export/capabilities';
import { runExport, verifyVideo, type VerifyResult } from '../export/runExport';
import { audioBufferToWav, mixExportAudio } from '../audio/audioCapture';
import type { NarrationFile } from '../audio/narration';

interface Props {
  project: Project;
  timeline: Timeline;
  musicBuffer: AudioBuffer | null;
  /** A track the user loaded (unfitted); refitted to each format's timeline in batch export. */
  customMusic?: AudioBuffer | null;
  /** The narration to mix: the user's file, or the studio voice track for `timeline`. */
  narrationFile: NarrationFile | null;
  /** Studio-voice timing, so batch export lays out each format exactly like the preview. */
  voice?: VoiceTiming | null;
  /** Rebuilds the studio voice track for another format's timeline (the Short starts with a hook). */
  studioTrackFor?: (tl: Timeline) => AudioBuffer | null;
  /** Rewritten lines the studio voice has no audio for. */
  missingVoice?: number;
  onClose(): void;
  onAspectChange(a: Project['settings']['aspect']): void;
}

type Phase = 'setup' | 'running' | 'done' | 'error';

interface MethodOption {
  key: string;
  method: ExportMethod;
  label: string;
  detail: string;
  container: 'video/mp4' | 'video/webm';
  extension: 'mp4' | 'webm';
  recorderMimeType?: string;
}

interface BatchItem {
  label: string;
  result: ExportResult;
  url: string;
  verify: VerifyResult;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ExportDialog({ project, timeline, musicBuffer, customMusic, narrationFile, voice, studioTrackFor, missingVoice = 0, onClose, onAspectChange }: Props) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);
  const [methodKey, setMethodKey] = useState<string>('');
  const [res, setRes] = useState<'full' | 'hd'>('full');
  const [includeMusic, setIncludeMusic] = useState(project.settings.music);
  const [includeNarration, setIncludeNarration] = useState(true);
  const [burnSubs, setBurnSubs] = useState(project.settings.subtitles.enabled);
  const [phase, setPhase] = useState<Phase>('setup');
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);

  const aspect = project.settings.aspect;
  const embedded = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const full = EXPORT_SIZES[aspect];
  const size = res === 'full' ? full : { width: Math.round((full.width * 2) / 3), height: Math.round((full.height * 2) / 3) };
  const mode = project.settings.narrationMode;
  const studioNarration = mode === 'studio' && !!narrationFile;
  const fileNarration = (mode === 'file' || mode === 'studio') && !!narrationFile;

  useEffect(() => {
    detectCapabilities().then(setCaps, (e) => setCapsError(String(e)));
  }, []);

  const options = useMemo<MethodOption[]>(() => {
    if (!caps) return [];
    const list: MethodOption[] = [];
    const vc = caps.webCodecs.available ? caps.webCodecs.video[aspect] : null;
    if (vc) {
      list.push({
        key: 'webcodecs',
        method: 'webcodecs-mp4',
        label: vc.family === 'avc' ? 'MP4 · H.264 (WebCodecs)' : 'MP4 · VP9 (WebCodecs)',
        detail: `Frame-accurate, rendered frame by frame. Speed depends on the encoder — hardware H.264 is often faster than real time, software VP9 can be slower. Audio: ${caps.webCodecs.audio ? caps.webCodecs.audio.toUpperCase() : 'none available'}.`,
        container: 'video/mp4',
        extension: 'mp4',
      });
    }
    if (caps.recorder.available) {
      for (const f of caps.recorder.formats) {
        list.push({
          key: `rec:${f.mimeType}`,
          method: 'mediarecorder',
          label: `${f.extension.toUpperCase()} · MediaRecorder`,
          detail: `${f.label}. Records in real time (≈${timeline.total.toFixed(0)} s or longer). Keep this tab visible.`,
          container: f.container,
          extension: f.extension,
          recorderMimeType: f.mimeType,
        });
      }
    }
    return list;
  }, [caps, aspect, timeline.total]);

  useEffect(() => {
    if (options.length && !options.find((o) => o.key === methodKey)) setMethodKey(options[0].key);
  }, [options, methodKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const chosen = options.find((o) => o.key === methodKey);

  const start = async () => {
    if (!chosen || !caps) return;
    const settings: ExportSettings = {
      aspect,
      width: size.width,
      height: size.height,
      fps: EXPORT_FPS,
      method: chosen.method,
      container: chosen.container,
      recorderMimeType: chosen.recorderMimeType,
      extension: chosen.extension,
      videoBitrate: res === 'full' ? 8_000_000 : 5_000_000,
      includeMusic: includeMusic && !!musicBuffer,
      includeNarrationFile: fileNarration && includeNarration,
      burnSubtitles: burnSubs,
      filmGrain: project.settings.filmGrain,
    };
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('running');
    setProgress(0);
    setError(null);
    setVerify(null);
    setStartedAt(performance.now());
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    try {
      const out = await runExport({
        project,
        timeline,
        settings,
        capabilities: caps,
        musicBuffer,
        narrationBuffer: narrationFile?.buffer ?? null,
        signal: ac.signal,
        onProgress: (p, l) => {
          setProgress(p);
          setLabel(l);
        },
      });
      setResult(out);
      setResultUrl(URL.createObjectURL(out.blob));
      setPhase('done');
      setVerify(await verifyVideo(out.blob, out.duration));
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') {
        setPhase('setup');
        setLabel('');
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  };

  /** Export the YouTube cut (16:9) and the Short (9:16, with hook) one after the other. */
  const startBoth = async () => {
    if (!caps) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('running');
    setProgress(0);
    setError(null);
    setVerify(null);
    setResult(null);
    batch.forEach((b) => URL.revokeObjectURL(b.url));
    setBatch([]);
    setStartedAt(performance.now());
    const done: BatchItem[] = [];
    try {
      for (const [i, a] of (['16:9', '9:16'] as const).entries()) {
        const proj: Project = { ...project, settings: { ...project.settings, aspect: a } };
        const tl = buildTimeline(proj, undefined, mode === 'studio' ? voice : null);
        const music = includeMusic ? (customMusic ? fitMusicTrack(customMusic, tl) : await renderAmbience(tl)) : null;
        const vc = caps.webCodecs.available ? caps.webCodecs.video[a] : null;
        const rec = caps.recorder.formats.find((f) => f.extension === 'mp4') ?? caps.recorder.formats[0];
        if (!vc && !rec) throw new Error('No video encoder is available in this browser.');
        const full2 = EXPORT_SIZES[a];
        const sz = res === 'full' ? full2 : { width: Math.round((full2.width * 2) / 3), height: Math.round((full2.height * 2) / 3) };
        const settings: ExportSettings = {
          aspect: a,
          width: sz.width,
          height: sz.height,
          fps: EXPORT_FPS,
          method: vc ? 'webcodecs-mp4' : 'mediarecorder',
          container: vc ? 'video/mp4' : rec!.container,
          recorderMimeType: vc ? undefined : rec!.mimeType,
          extension: vc ? 'mp4' : rec!.extension,
          videoBitrate: res === 'full' ? 8_000_000 : 5_000_000,
          includeMusic: includeMusic && !!music,
          includeNarrationFile: fileNarration && includeNarration,
          burnSubtitles: burnSubs,
          filmGrain: project.settings.filmGrain,
        };
        const label = a === '16:9' ? 'YouTube · 16:9' : 'Short / Reels / TikTok · 9:16 with hook';
        const out = await runExport({
          project: proj,
          timeline: tl,
          settings,
          capabilities: caps,
          musicBuffer: music,
          narrationBuffer: studioNarration && studioTrackFor ? studioTrackFor(tl) : (narrationFile?.buffer ?? null),
          signal: ac.signal,
          onProgress: (p, l) => {
            setProgress((i + p) / 2);
            setLabel(`${label}: ${l}`);
          },
        });
        const item: BatchItem = { label, result: out, url: URL.createObjectURL(out.blob), verify: await verifyVideo(out.blob, out.duration) };
        done.push(item);
        setBatch([...done]);
      }
      setPhase('done');
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') {
        setPhase('setup');
        setLabel('');
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  };

  const elapsed = phase === 'running' ? (performance.now() - startedAt) / 1000 : 0;

  const downloadSoundtrack = async () => {
    const buf = await mixExportAudio({
      duration: timeline.total,
      music: musicBuffer && includeMusic ? { buffer: musicBuffer, gain: project.settings.musicVolume } : null,
      narration: fileNarration && narrationFile ? { buffer: narrationFile.buffer, gain: 1 } : null,
    });
    if (buf) download(audioBufferToWav(buf), 'fox-files-mkultra-soundtrack.wav');
  };

  const script = project.scenes.map((s, i) => `SCENE ${i + 1} — ${s.title.toUpperCase()}\n${s.narration}\n`).join('\n');

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-title" onMouseDown={(e) => e.target === e.currentTarget && phase !== 'running' && onClose()}>
      <div className="modal export-modal">
        <header className="modal-head">
          <h2 id="export-title">Export video</h2>
          <button className="btn icon ghost" onClick={onClose} disabled={phase === 'running'} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="export-grid">
          <dl className="summary">
            <dt>Aspect ratio</dt>
            <dd>
              <div className="segmented compact">
                {(['16:9', '9:16'] as const).map((a) => (
                  <button key={a} className={aspect === a ? 'on' : ''} disabled={phase === 'running'} onClick={() => onAspectChange(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </dd>
            <dt>Target size</dt>
            <dd>
              <div className="segmented compact">
                <button className={res === 'full' ? 'on' : ''} disabled={phase === 'running'} onClick={() => setRes('full')}>
                  {full.width}×{full.height}
                </button>
                <button className={res === 'hd' ? 'on' : ''} disabled={phase === 'running'} onClick={() => setRes('hd')}>
                  {Math.round((full.width * 2) / 3)}×{Math.round((full.height * 2) / 3)}
                </button>
              </div>
            </dd>
            <dt>Frame rate</dt>
            <dd>{EXPORT_FPS} fps</dd>
            <dt>Duration</dt>
            <dd>
              {formatTime(timeline.total)} ({timeline.total.toFixed(1)} s, {Math.round(timeline.total * EXPORT_FPS)} frames)
            </dd>
            <dt>Subtitles</dt>
            <dd>
              <label className="check inline">
                <input type="checkbox" checked={burnSubs} disabled={phase === 'running'} onChange={(e) => setBurnSubs(e.target.checked)} />
                Burn in {timeline.cues.length} cues
              </label>
              {!project.settings.subtitles.enabled && burnSubs && <span className="muted small"> (subtitles are hidden in the preview)</span>}
            </dd>
            <dt>Audio</dt>
            <dd>
              <label className="check inline">
                <input type="checkbox" checked={includeMusic} disabled={phase === 'running' || !musicBuffer} onChange={(e) => setIncludeMusic(e.target.checked)} />
                Score &amp; room tone {!musicBuffer && <span className="muted">(still generating…)</span>}
              </label>
              {fileNarration && (
                <label className="check inline">
                  <input type="checkbox" checked={includeNarration} disabled={phase === 'running'} onChange={(e) => setIncludeNarration(e.target.checked)} />
                  {studioNarration ? narrationFile!.name : <>Narration file “{narrationFile!.name}”</>}
                </label>
              )}
            </dd>
          </dl>

          <div className="narration-status">
            {mode === 'speech' && (
              <p className="notice warn">
                <strong>Narration is not in the exported file.</strong> The preview voice comes from your operating system’s speech engine,
                which browsers do not let pages record. For a voiced video pick <em>Narration &amp; audio → Studio voice</em> (neural narrator, exported),
                load a recording under <em>Audio file</em>, or add a voice-over later using the subtitle and script files below.
              </p>
            )}
            {mode === 'file' && !narrationFile && <p className="notice warn">Audio-file narration is selected but no file is loaded, so no narration will be exported.</p>}
            {mode === 'studio' && !narrationFile && <p className="notice warn">The studio voice is still loading (or its pack is missing), so no narration would be exported yet.</p>}
            {studioNarration && includeNarration && (
              <p className={`notice ${missingVoice ? 'warn' : 'ok'}`}>
                The studio voice is mixed into the export, timed exactly like the preview.
                {missingVoice > 0 && ` ${missingVoice} rewritten ${missingVoice === 1 ? 'line has' : 'lines have'} no studio audio yet and will be silent — run the local voice server or restore the original text.`}
              </p>
            )}
            {mode === 'file' && fileNarration && includeNarration && <p className="notice ok">Your narration file is mixed into the export.</p>}
            {mode === 'off' && <p className="notice">Narration is off.</p>}
          </div>

          <div className="formats">
            <h3>Output format</h3>
            {!caps && !capsError && <p className="muted">Checking what this browser can encode…</p>}
            {capsError && <p className="notice warn">{capsError}</p>}
            {caps && !options.length && (
              <p className="notice warn">This browser supports neither WebCodecs H.264 nor MediaRecorder with canvas capture, so it cannot export video. Try a current Chrome, Edge, Firefox or Safari.</p>
            )}
            {options.map((o) => (
              <label key={o.key} className={`format-opt ${methodKey === o.key ? 'on' : ''}`}>
                <input type="radio" name="fmt" checked={methodKey === o.key} disabled={phase === 'running'} onChange={() => setMethodKey(o.key)} />
                <span>
                  <strong>{o.label}</strong>
                  <span className="muted small">{o.detail}</span>
                </span>
                <span className="ext">.{o.extension}</span>
              </label>
            ))}
            {caps && caps.webCodecs.video[aspect]?.family === 'vp9' && (
              <p className="help">This browser exposes no H.264 encoder, so WebCodecs MP4 uses VP9 video. MediaRecorder output depends on the browser.</p>
            )}
            {caps && !caps.webCodecs.video[aspect] && (
              <p className="help">
                MP4 through WebCodecs isn’t available here (no H.264 or VP9 encoder exposed for {full.width}×{full.height}).{' '}
                {caps.recorder.formats.some((f) => f.extension === 'mp4')
                  ? 'MediaRecorder can still produce MP4.'
                  : 'The export will be WebM — a real WebM file, never renamed to .mp4. Convert it with a tool such as HandBrake or ffmpeg if you need MP4.'}
              </p>
            )}
          </div>
        </div>

        {phase === 'running' && (
          <div className="progress-wrap" aria-live="polite">
            <div className="progress">
              <div className="bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="row between">
              <span className="small">{label}</span>
              <span className="small muted">
                {Math.round(progress * 100)}% · {elapsed.toFixed(0)} s elapsed
              </span>
            </div>
          </div>
        )}

        {phase === 'error' && <p className="notice warn">Export failed: {error}</p>}
        {embedded && (
          <p className="notice warn">
            This studio is running inside an embedded frame. Some hosts block file downloads there; if the download button does nothing, run the
            project locally (npm run dev) to export.
          </p>
        )}

        {phase === 'done' && result && resultUrl && (
          <div className="result">
            <p className="notice ok">
              <strong>{result.fileName}</strong> — {mb(result.blob.size)}, {result.mimeType}. {result.audioDescription}
            </p>
            {result.notes.map((n) => (
              <p key={n} className="notice">
                {n}
              </p>
            ))}
            {verify ? <p className={`notice ${verify.playable ? 'ok' : 'warn'}`}>{verify.message}</p> : <p className="muted small">Checking the file plays…</p>}
            <a className="btn primary" href={resultUrl} download={result.fileName}>
              Download {result.fileName.split('.').pop()?.toUpperCase()}
            </a>
          </div>
        )}

        {batch.length > 0 && (
          <div className="result">
            {batch.map((b) => (
              <div key={b.label} className="batch-item">
                <p className="notice ok">
                  <strong>{b.label}</strong> — {b.result.fileName}, {mb(b.result.blob.size)}, {b.result.mimeType}. {b.result.audioDescription}
                </p>
                {b.result.notes.map((n) => (
                  <p key={n} className="notice">
                    {n}
                  </p>
                ))}
                <p className={`notice ${b.verify.playable ? 'ok' : 'warn'}`}>{b.verify.message}</p>
                <a className="btn primary" href={b.url} download={b.result.fileName}>
                  Download {b.label.split(' ·')[0]}
                </a>
              </div>
            ))}
          </div>
        )}

        <footer className="modal-foot">
          <div className="extras">
            <span className="muted small">Separate files:</span>
            <button className="btn small ghost" onClick={() => download(new Blob([toSRT(timeline)], { type: 'application/x-subrip' }), 'fox-files-mkultra.srt')}>
              Subtitles .srt
            </button>
            <button className="btn small ghost" onClick={() => download(new Blob([toVTT(timeline)], { type: 'text/vtt' }), 'fox-files-mkultra.vtt')}>
              .vtt
            </button>
            <button className="btn small ghost" onClick={() => download(new Blob([script], { type: 'text/plain' }), 'fox-files-mkultra-narration.txt')}>
              Narration script
            </button>
            <button className="btn small ghost" disabled={!musicBuffer && !fileNarration} onClick={downloadSoundtrack}>
              Soundtrack .wav
            </button>
            <button className="btn small ghost" onClick={() => download(new Blob([buildPublishingKit(project, mode === 'studio' ? voice : null)], { type: 'text/plain' }), 'fox-files-mkultra-publishing-kit.txt')}>
              Publishing kit
            </button>
          </div>
          <div className="row gap">
            {phase === 'running' ? (
              <button className="btn" onClick={() => abortRef.current?.abort()}>
                Cancel export
              </button>
            ) : (
              <>
                <button className="btn" disabled={!chosen} onClick={start}>
                  Export {aspect} only
                </button>
                <button className="btn primary" disabled={!caps} onClick={startBoth} title="16:9 for YouTube, then 9:16 with the hook for Shorts, Reels and TikTok">
                  Export YouTube + Short
                </button>
              </>
            )}
          </div>
        </footer>
        <p className="help foot-note">
          Rendering happens entirely in this browser. Real-time recording at 1080p/30 fps takes about as long as the video ({timeline.total.toFixed(0)} s) or
          longer on slower machines; WebCodecs speed depends on the available encoder. {timeline.voiced ? 'Burned-in subtitles are timed from the studio voice.' : 'Burned-in subtitle timing is estimated from word counts.'}
        </p>
      </div>
    </div>
  );
}
