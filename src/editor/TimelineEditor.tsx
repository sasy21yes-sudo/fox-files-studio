import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Project } from '../types';
import { formatTime, locate, type SceneSpan, type Timeline } from '../animation/timeline';
import { placeBeats } from '../effects/beats';
import { sceneBeats } from '../data/projectText';
import { MAX_SCENE_DURATION, MIN_SCENE_DURATION } from '../data/project';
import { ELEMENTS } from '../scene/elements';
import type { ElementBase, FoxAction, Key } from '../scene/spec';
import {
  foxOf,
  foxTrack,
  moveScene,
  setFoxTrack,
  toAuthored,
  toGlobal,
  updateElement,
  updateFox,
  updateScene,
  updateShot,
  type FoxTrack,
  type Selection,
} from './model';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  timeline: Timeline;
  time: number;
  selection: Selection;
  onSeek(t: number): void;
  onSelect(s: Selection): void;
  onChange: Change;
  musicOn: boolean;
}

const HEAD_W = 148;
const SNAP_PX = 7;

/** Drag a clip or key: reports the time delta (s) with snapping to `snaps` (global seconds). */
function startDrag(
  e: RPointerEvent,
  pps: number,
  origin: number,
  snaps: number[],
  move: (t: number, dt: number) => void,
  end?: (t: number) => void,
) {
  e.stopPropagation();
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const x0 = e.clientX;
  let moved = false;
  let last = origin;
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3) return;
    moved = true;
    let t = origin + dx / pps;
    const snap = snaps.find((s) => Math.abs(s - t) * pps < SNAP_PX);
    if (snap !== undefined && !ev.altKey) t = snap;
    last = t;
    move(t, t - origin);
  };
  const onUp = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    if (moved) end?.(last);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

function Row({ head, children, className = '', sub }: { head: ReactNode; children: ReactNode; className?: string; sub?: boolean }) {
  return (
    <div className={`tl-row ${className}`}>
      <div className={`tl-head ${sub ? 'sub' : ''}`}>{head}</div>
      <div className="tl-lane">{children}</div>
    </div>
  );
}

const ACTION_LABEL: Record<FoxAction['kind'], string> = {
  walk: 'Walk',
  skid: 'Skid',
  take: 'Take!',
  pop: 'Pop',
  sparkle: 'Sparkle',
  sweat: 'Sweat',
  hop: 'Hop',
};

const keyLabel = (v: unknown): string =>
  typeof v === 'string' ? v || '—' : typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : v && typeof v === 'object' && 'target' in v ? `→ ${(v as { target: string }).target}` : 'look';

export function TimelineEditor({ project, timeline, time, selection, onSeek, onSelect, onChange, musicOn }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(12);
  const [fitted, setFitted] = useState(false);
  const [reorder, setReorder] = useState<{ from: number; to: number } | null>(null);
  const total = Math.max(1, timeline.total);
  const width = total * pps;
  const X = (t: number) => t * pps;
  const lang = project.settings.language;

  // Fit the whole episode on first show.
  const fit = () => {
    const w = (scrollRef.current?.clientWidth ?? 1000) - HEAD_W - 24;
    setPps(Math.max(2, Math.min(400, w / total)));
  };
  useEffect(() => {
    if (!fitted && scrollRef.current) {
      fit();
      setFitted(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted]);

  // Ctrl/⌘ + wheel zooms around the pointer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - HEAD_W + el.scrollLeft;
      setPps((p) => {
        const next = Math.max(2, Math.min(400, p * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        requestAnimationFrame(() => (el.scrollLeft = (x / p) * next - (e.clientX - r.left - HEAD_W)));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const sceneIndex = selection.scene;
  const span: SceneSpan | undefined = timeline.spans[sceneIndex];
  const spec = span?.scene.spec;
  const fox = foxOf(spec);

  const sceneSnaps = useMemo(() => [0, total, ...timeline.spans.flatMap((s) => [s.start, s.end])], [timeline, total]);
  const snaps = [...sceneSnaps, time];

  const seekFromLane = (e: RPointerEvent) => {
    const lane = e.currentTarget as HTMLElement;
    const r = lane.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(total, (e.clientX - r.left) / pps)));
  };

  // ---------------------------------------------------------------- ruler
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 70) ?? 120;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(t);

  const isSel = (s: Partial<Selection> & { kind: Selection['kind'] }) =>
    selection.kind === s.kind && Object.entries(s).every(([k, v]) => (selection as Record<string, unknown>)[k] === v);

  // ---------------------------------------------------------------- scene-local helpers
  const g = (k: number) => (span ? toGlobal(span, k) : 0);
  const a = (t: number) => (span ? toAuthored(span, t) : 0);
  const sceneLocalSnaps = span ? [...snaps, span.start, span.end] : snaps;

  const moveKey = (track: FoxTrack, index: number) => (e: RPointerEvent) => {
    if (!fox || !span) return;
    const keys = foxTrack(fox, track);
    onSelect({ kind: 'key', scene: sceneIndex, track, index });
    startDrag(e, pps, g(keys[index].at), sceneLocalSnaps, (t) => {
      const at = Math.max(0, Math.round(a(t) * 100) / 100);
      onChange((p) => updateFox(p, sceneIndex, (f) => setFoxTrack(f, track, foxTrack(f, track).map((k, i) => (i === index ? { ...k, at } : k)))), `key:${track}:${index}`);
    });
  };

  const keyLane = (tracks: FoxTrack[]) => {
    if (!fox) return null;
    const items = tracks
      .flatMap((track) => foxTrack(fox, track).map((k: Key<unknown>, i) => ({ track, i, k, x: X(g(k.at)), label: track.startsWith('face.') ? `${track.slice(5)} ${keyLabel(k.value)}` : keyLabel(k.value) })))
      .sort((p, q) => p.x - q.x);
    return items.map((it, n) => {
      // Labels only where they fit before the next key (zoom in to read them all).
      const room = (items[n + 1]?.x ?? Infinity) - it.x;
      return (
        <button
          key={`${it.track}-${it.i}`}
          className={`tl-key ${isSel({ kind: 'key', scene: sceneIndex, track: it.track, index: it.i }) ? 'sel' : ''}`}
          style={{ left: it.x }}
          title={`${it.track} · ${keyLabel(it.k.value)} @ ${it.k.at.toFixed(2)}s (authored)`}
          onPointerDown={moveKey(it.track, it.i)}
        >
          {room > it.label.length * 6 + 18 && <span className="tl-key-label">{it.label}</span>}
        </button>
      );
    });
  };

  const zoomToScene = (index = sceneIndex) => {
    const sp = timeline.spans[index];
    const el = scrollRef.current;
    if (!sp || !el) return;
    const next = Math.max(2, Math.min(400, (el.clientWidth - HEAD_W - 40) / sp.duration));
    setPps(next);
    requestAnimationFrame(() => (el.scrollLeft = sp.start * next - 8));
  };

  const elementLane = (el: ElementBase) => {
    if (!span) return null;
    const from = el.from ?? 0;
    const to = el.to ?? span.scene.authoredDuration;
    const sel = isSel({ kind: 'element', scene: sceneIndex, id: el.id });
    const edge = (which: 'from' | 'to') => (e: RPointerEvent) => {
      onSelect({ kind: 'element', scene: sceneIndex, id: el.id });
      startDrag(e, pps, g(which === 'from' ? from : to), sceneLocalSnaps, (t) => {
        const v = Math.max(0, Math.min(span.scene.authoredDuration, Math.round(a(t) * 100) / 100));
        onChange((p) => updateElement(p, sceneIndex, el.id, (x) => ({ ...x, [which]: v })), `el:${el.id}:${which}`);
      });
    };
    return (
      <div
        className={`tl-clip k-element ${sel ? 'sel' : ''} ${el.hidden ? 'hidden' : ''}`}
        style={{ left: X(g(from)), width: Math.max(4, X(g(to)) - X(g(from))) }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect({ kind: 'element', scene: sceneIndex, id: el.id });
        }}
      >
        <span className="tl-handle left" onPointerDown={edge('from')} />
        {el.enter && el.enter.kind !== 'none' && (
          <span className="tl-enter" style={{ left: X(g(el.enter.at)) - X(g(from)), width: Math.max(3, X(g(el.enter.at + el.enter.dur)) - X(g(el.enter.at))) }} title={`enter: ${el.enter.kind}`} />
        )}
        <span className="tl-clip-label">{el.label ?? ELEMENTS[el.type as keyof typeof ELEMENTS]?.label ?? el.type}</span>
        <span className="tl-handle right" onPointerDown={edge('to')} />
      </div>
    );
  };

  // ---------------------------------------------------------------- render
  return (
    <section className="tl" aria-label="Timeline">
      <div className="tl-toolbar">
        <span className="panel-title">Timeline</span>
        <span className="timecode small">
          {formatTime(time)} <span className="muted">/ {formatTime(total)}</span>
        </span>
        <span className="tl-spacer" />
        <span className="muted small">Ctrl+wheel: zoom · Alt: no snap · Del: delete</span>
        <button className="btn small ghost" onClick={() => setPps((p) => Math.max(2, p / 1.4))} aria-label="Zoom out">
          −
        </button>
        <input type="range" min={2} max={400} step={1} value={Math.round(pps)} onChange={(e) => setPps(+e.target.value)} aria-label="Zoom" className="tl-zoom" />
        <button className="btn small ghost" onClick={() => setPps((p) => Math.min(400, p * 1.4))} aria-label="Zoom in">
          +
        </button>
        <button className="btn small ghost" onClick={fit} title="Whole episode">
          Fit
        </button>
        <button className="btn small ghost" onClick={() => zoomToScene()} title="Zoom to the selected scene (or double-click a scene)">
          Scene
        </button>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-canvas" style={{ width: width + HEAD_W + 24 }}>
          <Row head={<span className="muted small">{formatTime(time)}</span>} className="ruler-row">
            <div className="tl-ruler" style={{ width }} onPointerDown={(e) => { seekFromLane(e); startDrag(e, pps, time, [], (t) => onSeek(Math.max(0, Math.min(total, t)))); }}>
              {ticks.map((t) => (
                <span key={t} className="tl-tick" style={{ left: X(t) }}>
                  {formatTime(t).replace(/\.0$/, '')}
                </span>
              ))}
            </div>
          </Row>

          {/* ------------------------------------------------ global tracks */}
          <Row head={<><b>V1</b> Scenes</>} className="scenes">
            <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
              {timeline.hook && (
                <div className="tl-clip k-hook" style={{ left: 0, width: X(timeline.hook.end) }} title="Short hook (9:16)">
                  <span className="tl-clip-label">Hook</span>
                </div>
              )}
              {timeline.spans.map((s) => (
                <div
                  key={s.scene.id}
                  className={`tl-clip k-scene ${s.index === sceneIndex ? 'sel' : ''} ${s.overflow ? 'overflow' : ''} ${s.scene.spec ? 'data' : 'coded'} ${reorder?.from === s.index ? 'dragging' : ''}`}
                  style={{ left: X(s.start), width: X(s.duration) }}
                  title={`${s.index + 1}. ${s.scene.title} — ${s.duration.toFixed(1)} s${s.extended ? ' (lengthened for the voice)' : ''}${s.scene.spec ? '' : ' · hand-coded'}`}
                  onPointerDown={(e) => {
                    onSelect({ kind: 'scene', scene: s.index });
                    // Drag to reorder: drop on the scene under the pointer.
                    startDrag(
                      e,
                      pps,
                      s.start + s.duration / 2,
                      [],
                      (t) => setReorder({ from: s.index, to: locate(timeline, t).span.index }),
                      (t) => {
                        const to = locate(timeline, t).span.index;
                        setReorder(null);
                        if (to !== s.index) {
                          onChange((p) => moveScene(p, s.index, to));
                          onSelect({ kind: 'scene', scene: to });
                        }
                      },
                    );
                  }}
                  onPointerUp={() => setReorder(null)}
                  onDoubleClick={() => zoomToScene(s.index)}
                >
                  <span className="tl-clip-label">
                    {s.index + 1}. {s.scene.title}
                  </span>
                  <span className="tl-clip-dur">{s.duration.toFixed(1)}s</span>
                  <span
                    className="tl-handle right"
                    title="Drag to change the scene length"
                    onPointerDown={(e) => {
                      onSelect({ kind: 'scene', scene: s.index });
                      startDrag(e, pps, s.end, [...sceneSnaps.filter((x) => x !== s.end), time], (t) => {
                        const d = Math.max(MIN_SCENE_DURATION, Math.min(MAX_SCENE_DURATION, Math.round((t - s.start) * 10) / 10));
                        onChange((p) => updateScene(p, s.index, { duration: d }), `dur:${s.scene.id}`);
                      });
                    }}
                  />
                </div>
              ))}
              {reorder && reorder.to !== reorder.from && (
                <div className="tl-drop" style={{ left: X(reorder.to > reorder.from ? timeline.spans[reorder.to].end : timeline.spans[reorder.to].start) }} />
              )}
            </div>
          </Row>

          <Row head="Pop-ups">
            <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
              {timeline.spans.flatMap((s) => {
                const beats = sceneBeats(s.scene, lang);
                return placeBeats(timeline, s.index).map((pb) => {
                  const index = beats.indexOf(pb.beat);
                  return (
                    <div
                      key={`${s.scene.id}-${index}`}
                      className={`tl-clip k-beat ${isSel({ kind: 'beat', scene: s.index, index }) ? 'sel' : ''}`}
                      style={{ left: X(pb.start), width: Math.max(4, X(pb.end - pb.start)) }}
                      title={`${pb.beat.kind} — on “${pb.beat.cue}”`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect({ kind: 'beat', scene: s.index, index });
                        onSeek(pb.start + 0.6);
                      }}
                    >
                      <span className="tl-clip-label">{pb.beat.kind}</span>
                    </div>
                  );
                });
              })}
            </div>
          </Row>

          <Row head="Subtitles">
            <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
              {timeline.cues.map((c) => (
                <div
                  key={c.id}
                  className={`tl-clip k-cue ${c.timing}`}
                  style={{ left: X(c.start), width: Math.max(2, X(c.end - c.start)) }}
                  title={c.text}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (c.sceneIndex >= 0) onSelect({ kind: 'scene', scene: c.sceneIndex });
                    onSeek(c.start + 0.01);
                  }}
                >
                  <span className="tl-clip-label">{c.text}</span>
                </div>
              ))}
            </div>
          </Row>

          <Row head={<><b>A1</b> Voice</>}>
            <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
              {timeline.clips.map((c, i) => (
                <div key={i} className="tl-clip k-voice" style={{ left: X(c.start), width: Math.max(2, X(c.duration)) }} title={c.text} />
              ))}
              {!timeline.clips.length && <span className="tl-empty">no recorded voice — cues are estimated</span>}
            </div>
          </Row>

          <Row head={<><b>A2</b> Music</>}>
            <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
              {musicOn && <div className="tl-clip k-music" style={{ left: 0, width }} title="Score / music track (ducked under the voice)" />}
            </div>
          </Row>

          {/* ------------------------------------------------ selected scene */}
          {span && (
            <div className="tl-group-head">
              <div className="tl-head group">
                Scene {span.index + 1} · {span.scene.title}
              </div>
              <div className="tl-lane">
                <div className="tl-scope" style={{ left: X(span.start), width: X(span.duration) }} />
              </div>
            </div>
          )}

          {span && !spec && (
            <Row head="Choreography" sub>
              <div className="tl-lane-inner" style={{ width }}>
                <span className="tl-empty" style={{ left: X(span.start) }}>
                  Hand-coded scene: its acting is not editable here (only scenes made of data are).
                </span>
              </div>
            </Row>
          )}

          {span && spec && (
            <>
              <Row head="Camera" sub>
                <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
                  {spec.camera.map((shot, i) => {
                    const next = spec.camera[i + 1];
                    const from = g(shot.at);
                    const to = next ? g(next.at) : span.end;
                    return (
                      <div
                        key={i}
                        className={`tl-clip k-shot ${shot.kind} ${isSel({ kind: 'shot', scene: sceneIndex, index: i }) ? 'sel' : ''}`}
                        style={{ left: X(from), width: Math.max(4, X(to) - X(from)) }}
                        title={`${shot.kind}${shot.target && typeof shot.target === 'string' ? ` on ${shot.target}` : ''} · ${shot.enter ?? 'cut'}`}
                        onPointerDown={(e) => {
                          onSelect({ kind: 'shot', scene: sceneIndex, index: i });
                          if (i === 0) return e.stopPropagation();
                          startDrag(e, pps, from, sceneLocalSnaps, (t) => {
                            const at = Math.max(0.05, Math.round(a(t) * 100) / 100);
                            onChange((p) => updateShot(p, sceneIndex, i, { at }), `shot:${i}`);
                          });
                        }}
                      >
                        <span className="tl-clip-label">
                          {shot.enter === 'whip' ? '↯ ' : shot.enter === 'push' ? '⇢ ' : ''}
                          {shot.kind}
                          {typeof shot.target === 'string' && shot.target !== 'fox' ? ` · ${shot.target}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Row>

              {fox && (
                <>
                  <Row head="Fox · actions" sub>
                    <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
                      {(fox.actions ?? []).map((act, i) => {
                        const from = g(act.at);
                        const to = g(act.at + act.len);
                        return (
                          <div
                            key={i}
                            className={`tl-clip k-action ${act.kind} ${isSel({ kind: 'action', scene: sceneIndex, index: i }) ? 'sel' : ''}`}
                            style={{ left: X(from), width: Math.max(6, X(to) - X(from)) }}
                            title={`${ACTION_LABEL[act.kind]} ${act.symbol ?? ''} @ ${act.at}s`}
                            onPointerDown={(e) => {
                              onSelect({ kind: 'action', scene: sceneIndex, index: i });
                              startDrag(e, pps, from, sceneLocalSnaps, (t) => {
                                const at = Math.max(0, Math.round(a(t) * 100) / 100);
                                onChange((p) => updateFox(p, sceneIndex, (f) => ({ ...f, actions: (f.actions ?? []).map((x, j) => (j === i ? { ...x, at } : x)) })), `act:${i}`);
                              });
                            }}
                          >
                            <span className="tl-clip-label">
                              {ACTION_LABEL[act.kind]}
                              {act.symbol ? ` ${act.symbol}` : ''}
                            </span>
                            <span
                              className="tl-handle right"
                              onPointerDown={(e) =>
                                startDrag(e, pps, to, sceneLocalSnaps, (t) => {
                                  const len = Math.max(0.1, Math.round((a(t) - act.at) * 100) / 100);
                                  onChange((p) => updateFox(p, sceneIndex, (f) => ({ ...f, actions: (f.actions ?? []).map((x, j) => (j === i ? { ...x, len } : x)) })), `actlen:${i}`);
                                })
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </Row>
                  <Row head="Fox · arms" sub>
                    <div className="tl-lane-inner keys" style={{ width }} onPointerDown={seekFromLane}>
                      {keyLane(['armFront', 'armBack'])}
                    </div>
                  </Row>
                  <Row head="Fox · face & look" sub>
                    <div className="tl-lane-inner keys" style={{ width }} onPointerDown={seekFromLane}>
                      {keyLane(['view', 'look', 'mouth', 'eyes', ...Object.keys(fox.face ?? {}).map((f) => `face.${f}` as FoxTrack)])}
                    </div>
                  </Row>
                </>
              )}

              {spec.elements
                .filter((el): el is ElementBase => el.type !== 'fox')
                .map((el) => (
                  <Row
                    key={el.id}
                    sub
                    head={
                      <span className="tl-el-head">
                        <button
                          className={`tl-eye ${el.hidden ? 'off' : ''}`}
                          title={el.hidden ? 'Show' : 'Hide'}
                          onClick={() => onChange((p) => updateElement(p, sceneIndex, el.id, (x) => ({ ...x, hidden: !x.hidden })))}
                        >
                          {el.hidden ? '◌' : '●'}
                        </button>
                        {el.label ?? el.id}
                      </span>
                    }
                  >
                    <div className="tl-lane-inner" style={{ width }} onPointerDown={seekFromLane}>
                      {elementLane(el)}
                    </div>
                  </Row>
                ))}
            </>
          )}

          <div className="tl-playhead" style={{ left: HEAD_W + X(time) }} />
        </div>
      </div>
    </section>
  );
}

