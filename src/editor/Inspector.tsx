import type { MediaItem, Project, Scene } from '../types';
import type { Timeline } from '../animation/timeline';
import { ARM_MODES, ELEMENTS, FACE_KEYS, MOUTHS } from '../scene/elements';
import type { ElementBase, EnterKind, FoxAction, FoxElement, Key, Num, SceneElement, ShotKind, ShotSpec } from '../scene/spec';
import type { Beat } from '../data/mkultraScript';
import { isMkScene, sceneBeats } from '../data/projectText';
import { countWords } from '../animation/timeline';
import {
  foxOf,
  foxTrack,
  setFoxTrack,
  toAuthored,
  updateElement,
  updateFox,
  updateScene,
  updateShot,
  updateSpec,
  type FoxTrack,
  type Selection,
} from './model';
import { Check, Field, Group, NumField, NumberInput, Select, Text } from './fields';
import { EaseField } from './EaseField';
import { LayerPanel } from './LayerPanel';
import { clipIndex, loadClipIndex } from '../media/clips';
import { useEffect, useState } from 'react';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  timeline: Timeline;
  time: number;
  selection: Selection;
  onSelect(s: Selection): void;
  onChange: Change;
  onSeek(t: number): void;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Write a scene's pop-ups in the current language (MKUltra keeps per-language copies). */
export function withBeats(scene: Scene, lang: Project['settings']['language'], beats: Beat[]): Partial<Scene> {
  return isMkScene(scene.id) ? { beatsByLang: { ...(scene.beatsByLang ?? {}), [lang]: beats } } : { beats };
}

export const BEAT_TEMPLATES: Record<Beat['kind'], Beat> = {
  question: { cue: '', kind: 'question', text: 'What really happened?' },
  span: { cue: '', kind: 'span', from: '1953', to: '1973', label: 'Twenty years' },
  count: { cue: '', kind: 'count', value: 10, label: 'Items' },
  versus: { cue: '', kind: 'versus', left: 'Claim', right: 'Record', caption: '' },
  define: { cue: '', kind: 'define', word: 'Word', pos: 'noun', meaning: 'What it means.' },
  waffle: { cue: '', kind: 'waffle', total: 100, hit: 25, label: 'Share' },
  list: { cue: '', kind: 'list', items: ['First', 'Second', 'Third'], title: 'List' },
  record: { cue: '', kind: 'record', tag: 'RECORD', who: 'Source', text: 'Quoted line from the record.', highlight: 'record', note: 'Paraphrase' },
  statement: { cue: '', kind: 'statement', lines: ['One strong line.'] },
  person: { cue: '', kind: 'person', name: 'Name', role: 'Role from the sources', year: '1977' },
};

// ------------------------------------------------------------------ elements

function ElementPanel({ el, scene, vertical, onChange, onSelect, specLen, media }: {
  media: MediaItem[];
  el: ElementBase;
  scene: number;
  vertical: boolean;
  onChange: Change;
  onSelect(s: Selection): void;
  specLen: number;
}) {
  const def = ELEMENTS[el.type as keyof typeof ELEMENTS];
  const set = (patch: Partial<ElementBase>, key: string) => onChange((p) => updateElement(p, scene, el.id, (x) => ({ ...x, ...patch }) as SceneElement), `el:${el.id}:${key}`);
  const setParam = (name: string, v: unknown) =>
    onChange((p) => updateElement(p, scene, el.id, (x) => ({ ...x, params: { ...(x.params ?? {}), [name]: v } })), `el:${el.id}:p:${name}`);
  return (
    <>
      <Group title={def?.label ?? el.type}>
        <p className="help">{def?.description}</p>
        <Field label="Name">
          <Text value={el.label ?? ''} placeholder={el.id} onChange={(v) => set({ label: v || undefined }, 'label')} />
        </Field>
        <NumField label="X" value={el.x} fallback={0} vertical={vertical} onChange={(x) => set({ x }, 'x')} hint="frame fraction, 0 = left, 1 = right" />
        <NumField label="Y" value={el.y} fallback={0} vertical={vertical} onChange={(y) => set({ y }, 'y')} hint="frame fraction, 0 = top, 1 = bottom" />
        <NumField label="Scale" value={el.scale} fallback={1} vertical={vertical} onChange={(scale) => set({ scale }, 'scale')} />
        {typeof el.rot !== 'object' && (
          <Field label="Rotation">
            <NumberInput value={(el.rot as number | undefined) ?? 0} step={0.01} onChange={(rot) => set({ rot }, 'rot')} />
          </Field>
        )}
        <Check value={!!el.hidden} onChange={(hidden) => set({ hidden }, 'hidden')} label="Hidden" />
      </Group>

      <Group title="Timing">
        <Field label="Appears at" hint="authored seconds; empty = from the start">
          <NumberInput value={el.from ?? 0} step={0.05} min={0} onChange={(v) => set({ from: v || undefined }, 'from')} />
        </Field>
        <Field label="Leaves at" hint="authored seconds; empty = to the end">
          <NumberInput value={el.to ?? specLen} step={0.05} min={0} onChange={(v) => set({ to: v >= specLen ? undefined : v }, 'to')} />
        </Field>
        <Field label="Entrance">
          <Select<EnterKind>
            value={el.enter?.kind ?? 'none'}
            options={['none', 'drop', 'pop', 'fade', 'slideLeft', 'slideRight']}
            onChange={(kind) => set({ enter: kind === 'none' ? undefined : { kind, at: el.enter?.at ?? el.from ?? 0, dur: el.enter?.dur ?? 0.5 } }, 'enter')}
          />
        </Field>
        {el.enter && (
          <>
            <Field label="Entrance at">
              <NumberInput value={el.enter.at} step={0.05} min={0} onChange={(at) => set({ enter: { ...el.enter!, at } }, 'enterAt')} />
            </Field>
            <Field label="Entrance length">
              <NumberInput value={el.enter.dur} step={0.05} min={0.05} onChange={(dur) => set({ enter: { ...el.enter!, dur } }, 'enterDur')} />
            </Field>
          </>
        )}
        <Check value={!!el.bounce} onChange={(on) => set({ bounce: on ? { amt: 0.6, phase: 0 } : undefined }, 'bounce')} label="Hop on the beat" />
        {el.bounce && (
          <Field label="Hop amount">
            <NumberInput value={el.bounce.amt} step={0.05} min={0} max={2} onChange={(amt) => set({ bounce: { ...el.bounce!, amt } }, 'bounceAmt')} />
          </Field>
        )}
      </Group>

      {def && Object.keys(def.params).length > 0 && (
        <Group title="Parameters">
          {Object.entries(def.params).map(([name, info]) => {
            const v = el.params?.[name] ?? info.default;
            if (info.kind === 'media')
              return (
                <Field key={name} label="Image" hint={info.desc}>
                  <select className="isel" value={String(v ?? '')} onChange={(e) => setParam(name, e.target.value)}>
                    <option value="">— choose —</option>
                    {media.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                    {v && !media.some((m) => m.id === v) ? <option value={String(v)}>missing image ({String(v)})</option> : null}
                  </select>
                </Field>
              );
            if (info.kind === 'clip') return <ClipField key={name} value={String(v ?? '')} hint={info.desc} onChange={(id) => setParam(name, id)} />;
            if (info.options)
              return (
                <Field key={name} label={name} hint={info.desc}>
                  <Select value={String(v ?? info.default)} options={info.options} onChange={(o) => setParam(name, o)} />
                </Field>
              );
            if (typeof info.default === 'boolean') return <Check key={name} value={v === true} onChange={(b) => setParam(name, b)} label={info.desc} />;
            if (typeof info.default === 'string')
              return (
                <Field key={name} label={name} hint={info.desc}>
                  <Text value={String(v ?? '')} onChange={(s) => setParam(name, s)} />
                </Field>
              );
            const fallback = typeof info.default === 'number' ? info.default : vertical ? (info.default as { v: number }).v : (info.default as { h: number }).h;
            return <NumField key={name} label={name} hint={info.desc} value={v as Num} fallback={fallback} vertical={vertical} onChange={(n) => setParam(name, n)} />;
          })}
        </Group>
      )}

      <div className="iactions">
        <button
          className="btn small"
          onClick={() =>
            onChange((p) =>
              updateSpec(p, scene, (spec) => {
                const i = spec.elements.findIndex((e) => e.id === el.id);
                const els = [...spec.elements];
                if (i > 0) [els[i - 1], els[i]] = [els[i], els[i - 1]];
                return { ...spec, elements: els };
              }),
            )
          }
          title="Draw earlier (further back)"
        >
          ↑ Back
        </button>
        <button
          className="btn small"
          onClick={() =>
            onChange((p) =>
              updateSpec(p, scene, (spec) => {
                const i = spec.elements.findIndex((e) => e.id === el.id);
                const els = [...spec.elements];
                if (i < els.length - 1) [els[i + 1], els[i]] = [els[i], els[i + 1]];
                return { ...spec, elements: els };
              }),
            )
          }
          title="Draw later (in front)"
        >
          ↓ Front
        </button>
        <button
          className="btn small"
          onClick={() => {
            const id = `${el.id}-copy-${Math.random().toString(36).slice(2, 5)}`;
            onChange((p) =>
              updateSpec(p, scene, (spec) => {
                const i = spec.elements.findIndex((e) => e.id === el.id);
                const els = [...spec.elements];
                els.splice(i + 1, 0, { ...structuredClone(el), id, label: `${el.label ?? el.id} copy` });
                return { ...spec, elements: els };
              }),
            );
            onSelect({ kind: 'element', scene, id });
          }}
        >
          Duplicate
        </button>
        <button
          className="btn small danger"
          onClick={() => {
            onChange((p) => updateSpec(p, scene, (spec) => ({ ...spec, elements: spec.elements.filter((e) => e.id !== el.id) })));
            onSelect({ kind: 'scene', scene });
          }}
        >
          Delete
        </button>
      </div>
    </>
  );
}

/** Animation clip picker (the clip library, public/clips/index.json). */
function ClipField({ value, hint, onChange }: { value: string; hint: string; onChange(id: string): void }) {
  const [list, setList] = useState(clipIndex());
  useEffect(() => {
    void loadClipIndex().then(setList);
  }, []);
  return (
    <Field label="Animation clip" hint={hint}>
      <select className="isel" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— choose —</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label} · {c.frames} drawings · {c.duration.toFixed(2)} s
          </option>
        ))}
        {value && !list.some((c) => c.id === value) ? <option value={value}>missing clip ({value})</option> : null}
      </select>
    </Field>
  );
}

// ------------------------------------------------------------------ Agent Fox

function FoxPanel({ fox, scene, vertical, onChange, onSelect, kNow, ids }: {
  fox: FoxElement;
  scene: number;
  vertical: boolean;
  onChange: Change;
  onSelect(s: Selection): void;
  kNow: number;
  ids: string[];
}) {
  const set = (patch: Partial<FoxElement>, key: string) => onChange((p) => updateFox(p, scene, (f) => ({ ...f, ...patch })), `fox:${key}`);
  const addAction = (kind: FoxAction['kind']) => {
    const actions = [...(fox.actions ?? []), { kind, at: r2(kNow), len: kind === 'walk' ? 2 : kind === 'pop' ? 1.2 : 0.7, ...(kind === 'pop' ? { symbol: '!' as const } : {}), ...(kind === 'walk' ? { cadence: 1.7 } : {}) }];
    onChange((p) => updateFox(p, scene, (f) => ({ ...f, actions })));
    onSelect({ kind: 'action', scene, index: actions.length - 1 });
  };
  const addKey = (track: FoxTrack, value: unknown) => {
    const keys = [...foxTrack(fox, track), { at: r2(kNow), value } as Key<unknown>].sort((a, b) => a.at - b.at);
    onChange((p) => updateFox(p, scene, (f) => setFoxTrack(f, track, keys)));
    onSelect({ kind: 'key', scene, track, index: keys.findIndex((k) => k.at === r2(kNow) && k.value === value) });
  };
  return (
    <>
      <Group title="Agent Fox">
        <p className="help">Feet position and size. Acting lives on the timeline tracks below the scene; add it at the playhead.</p>
        <NumField label="X (feet)" value={fox.x} fallback={0.25} vertical={vertical} onChange={(x) => set({ x }, 'x')} hint="used when there is no walk (xTrack)" />
        <NumField label="Y (ground)" value={fox.y} fallback={0.9} vertical={vertical} onChange={(y) => set({ y }, 'y')} />
        <NumField label="Size" value={fox.scale} fallback={1.1} vertical={vertical} onChange={(scale) => set({ scale }, 'scale')} />
        <Check value={fox.facing === -1} onChange={(left) => set({ facing: left ? -1 : undefined }, 'facing')} label="Facing left" />
        <Field label="Points at">
          <Select
            value={fox.pointAt && 'target' in fox.pointAt ? fox.pointAt.target : fox.pointAt ? '(point)' : ''}
            options={['', ...ids, ...(fox.pointAt && !('target' in fox.pointAt) ? ['(point)'] : [])]}
            labels={{ '': 'straight ahead' }}
            onChange={(t) => t !== '(point)' && set({ pointAt: t ? { target: t } : undefined }, 'pointAt')}
          />
        </Field>
        {fox.xTrack?.length ? (
          <p className="help">
            He walks: {fox.xTrack.length} position keys.{' '}
            <button className="linkish" onClick={() => set({ xTrack: undefined }, 'xTrack')}>
              Remove the walk path
            </button>
          </p>
        ) : null}
      </Group>
      <Group title={`Add at the playhead (${kNow.toFixed(2)} s)`}>
        <div className="ichips">
          {(['walk', 'skid', 'take', 'pop', 'hop', 'sparkle', 'sweat'] as const).map((k) => (
            <button key={k} className="chip" onClick={() => addAction(k)}>
              + {k}
            </button>
          ))}
        </div>
        <Field label="Arm pose">
          <Select value="" options={['', ...ARM_MODES]} labels={{ '': 'add front-arm key…' }} onChange={(m) => m && addKey('armFront', m)} />
        </Field>
        <Field label="Back arm">
          <Select value="" options={['', ...ARM_MODES]} labels={{ '': 'add back-arm key…' }} onChange={(m) => m && addKey('armBack', m)} />
        </Field>
        <Field label="Mouth">
          <Select value="-" options={['-', ...MOUTHS]} labels={{ '-': 'add mouth key…', '': 'none (talking)' }} onChange={(m) => m !== '-' && addKey('mouth', m)} />
        </Field>
        <Field label="Eyes">
          <Select value="" options={['', 'open', 'happy']} labels={{ '': 'add eyes key…' }} onChange={(m) => m && addKey('eyes', m)} />
        </Field>
        <Field label="View" hint="front = waist-up, talking into the camera (a cut)">
          <Select value="" options={['', 'front', 'side']} labels={{ '': 'add view key…', front: 'front (talk to camera)', side: 'side (3/4 figure)' }} onChange={(m) => m && addKey('view', m)} />
        </Field>
        <Field label="Look at">
          <Select value="-" options={['-', 'camera', 'left', 'up', 'down', ...ids]} labels={{ '-': 'add look key…' }} onChange={(m) => {
            if (m === '-') return;
            const dir: Record<string, { x: number; y: number }> = { camera: { x: 0.3, y: 0.1 }, left: { x: -0.9, y: 0 }, up: { x: 0.4, y: -0.8 }, down: { x: 0.4, y: 0.8 } };
            addKey('look', dir[m] ?? { target: m });
          }} />
        </Field>
        <Field label="Face">
          <Select value="" options={['', ...FACE_KEYS]} labels={{ '': 'add face key…' }} onChange={(m) => m && addKey(`face.${m}`, 0.6)} />
        </Field>
      </Group>
    </>
  );
}

function ActionPanel({ act, index, scene, onChange, onSelect }: { act: FoxAction; index: number; scene: number; onChange: Change; onSelect(s: Selection): void }) {
  const set = (patch: Partial<FoxAction>, key: string) =>
    onChange((p) => updateFox(p, scene, (f) => ({ ...f, actions: (f.actions ?? []).map((a, i) => (i === index ? { ...a, ...patch } : a)) })), `act:${index}:${key}`);
  return (
    <Group title="Fox action">
      <Field label="Action">
        <Select value={act.kind} options={['walk', 'skid', 'take', 'pop', 'hop', 'sparkle', 'sweat'] as const} onChange={(kind) => set({ kind }, 'kind')} />
      </Field>
      <Field label="At (authored s)">
        <NumberInput value={act.at} step={0.05} min={0} onChange={(at) => set({ at }, 'at')} />
      </Field>
      <Field label="Length (s)">
        <NumberInput value={act.len} step={0.05} min={0.05} onChange={(len) => set({ len }, 'len')} />
      </Field>
      {act.kind === 'walk' && (
        <Field label="Steps / s">
          <NumberInput value={act.cadence ?? 1.7} step={0.1} min={0.3} max={5} onChange={(cadence) => set({ cadence }, 'cadence')} />
        </Field>
      )}
      {act.kind === 'pop' && (
        <Field label="Symbol">
          <Select value={act.symbol ?? '!'} options={['!', '?', '!?'] as const} onChange={(symbol) => set({ symbol }, 'symbol')} />
        </Field>
      )}
      <p className="help">A walk moves his legs; where he goes is the X path (keys on X). Skid, take and hop add body acting for their length.</p>
      <div className="iactions">
        <button
          className="btn small danger"
          onClick={() => {
            onChange((p) => updateFox(p, scene, (f) => ({ ...f, actions: (f.actions ?? []).filter((_, i) => i !== index) })));
            onSelect({ kind: 'scene', scene });
          }}
        >
          Delete
        </button>
      </div>
    </Group>
  );
}

function KeyPanel({ fox, track, index, scene, onChange, onSelect, ids }: { fox: FoxElement; track: FoxTrack; index: number; scene: number; onChange: Change; onSelect(s: Selection): void; ids: string[] }) {
  const keys = foxTrack(fox, track);
  const key = keys[index];
  if (!key) return null;
  const write = (k: Key<unknown> | null, coalesce: string) => {
    const next = k === null ? keys.filter((_, i) => i !== index) : keys.map((x, i) => (i === index ? k : x));
    onChange((p) => updateFox(p, scene, (f) => setFoxTrack(f, track, next)), `key:${track}:${index}:${coalesce}`);
  };
  const v = key.value;
  return (
    <Group title={`Key · ${track}`}>
      <Field label="At (authored s)">
        <NumberInput value={key.at} step={0.05} min={0} onChange={(at) => write({ ...key, at }, 'at')} />
      </Field>
      {(track === 'armFront' || track === 'armBack') && (
        <Field label="Pose">
          <Select value={v as string} options={ARM_MODES} onChange={(value) => write({ ...key, value }, 'v')} />
        </Field>
      )}
      {track === 'mouth' && (
        <Field label="Mouth">
          <Select value={v as string} options={MOUTHS} labels={{ '': 'none (talking)' }} onChange={(value) => write({ ...key, value }, 'v')} />
        </Field>
      )}
      {track === 'view' && (
        <Field label="View">
          <Select value={v as 'side' | 'front'} options={['side', 'front'] as const} onChange={(value) => write({ ...key, value }, 'v')} />
        </Field>
      )}
      {track === 'eyes' && (
        <Field label="Eyes">
          <Select value={v as 'open' | 'happy'} options={['open', 'happy'] as const} onChange={(value) => write({ ...key, value }, 'v')} />
        </Field>
      )}
      {track === 'look' && !!v && typeof v === 'object' && (
        <>
          <Field label="Look at">
            <Select
              value={'target' in v ? (v as { target: string }).target : '(direction)'}
              options={['(direction)', ...ids]}
              onChange={(t) => write({ ...key, value: t === '(direction)' ? { x: 0.3, y: 0.1 } : { target: t } }, 'v')}
            />
          </Field>
          {!('target' in v) && (
            <>
              <Field label="Pupils X">
                <NumberInput value={(v as { x: number }).x} step={0.05} min={-1} max={1} onChange={(x) => write({ ...key, value: { ...(v as object), x } }, 'x')} />
              </Field>
              <Field label="Pupils Y">
                <NumberInput value={(v as { y: number }).y} step={0.05} min={-1} max={1} onChange={(y) => write({ ...key, value: { ...(v as object), y } }, 'y')} />
              </Field>
            </>
          )}
        </>
      )}
      {track.startsWith('face.') && (
        <Field label="Amount">
          <NumberInput value={v as number} step={0.05} min={-1} max={1.5} onChange={(value) => write({ ...key, value }, 'v')} />
        </Field>
      )}
      {(track === 'armFront' || track === 'armBack' || track.startsWith('face.')) && (
        <>
          <Field label="Blend (s)">
            <NumberInput value={key.dur ?? (track.startsWith('face.') ? 0.4 : 0.38)} step={0.05} min={0} onChange={(dur) => write({ ...key, dur }, 'dur')} />
          </Field>
          <Field label="Easing">
            <EaseField value={key.ease ?? (track.startsWith('face.') ? 'smooth' : 'back')} onChange={(ease) => write({ ...key, ease }, 'ease')} />
          </Field>
        </>
      )}
      <div className="iactions">
        <button
          className="btn small danger"
          onClick={() => {
            write(null, 'del');
            onSelect({ kind: 'element', scene, id: fox.id });
          }}
        >
          Delete key
        </button>
      </div>
    </Group>
  );
}

function ShotPanel({ shot, index, scene, vertical, ids, onChange, onSelect }: { shot: ShotSpec; index: number; scene: number; vertical: boolean; ids: string[]; onChange: Change; onSelect(s: Selection): void }) {
  const set = (patch: Partial<ShotSpec>, key: string) => onChange((p) => updateShot(p, scene, index, patch), `shot:${index}:${key}`);
  // The renderer's defaults (scene/renderSpec.ts toShot), shown when the shot has no explicit value.
  const onFox = (shot.target ?? 'fox') === 'fox';
  const face = shot.kind !== 'medium';
  const def = onFox
    ? { sx: vertical ? 0.5 : 0.36, sy: vertical ? (face ? 0.56 : 0.52) : face ? 0.5 : 0.48 }
    : { sx: 0.5, sy: 0.5 };
  return (
    <Group title={`Shot ${index + 1}`}>
      <Field label="At (authored s)">
        <NumberInput value={shot.at} step={0.05} min={0} onChange={(at) => set({ at: index === 0 ? 0 : at }, 'at')} />
      </Field>
      <Field label="Framing">
        <Select<ShotKind> value={shot.kind} options={['wide', 'medium', 'close', 'extreme', 'insert']} onChange={(kind) => set({ kind }, 'kind')} />
      </Field>
      {shot.kind !== 'wide' && (
        <Field label="On">
          <Select value={typeof shot.target === 'string' ? shot.target : shot.target ? '(point)' : 'fox'} options={['fox', ...ids]} labels={{ fox: 'Agent Fox' }} onChange={(target) => set({ target }, 'target')} />
        </Field>
      )}
      <Field label="Into this shot">
        <Select value={shot.enter ?? 'cut'} options={['cut', 'push', 'whip'] as const} labels={{ cut: 'cut', push: 'push in', whip: 'whip pan' }} onChange={(enter) => set({ enter }, 'enter')} />
      </Field>
      {shot.kind !== 'wide' && (
        <>
          <NumField label="Screen X" value={shot.sx} fallback={def.sx} vertical={vertical} onChange={(sx) => set({ sx }, 'sx')} hint="where the subject lands on screen (0..1)" />
          <NumField label="Screen Y" value={shot.sy} fallback={def.sy} vertical={vertical} onChange={(sy) => set({ sy }, 'sy')} />
        </>
      )}
      <Field label="Zoom" hint="empty = standard framing">
        <NumberInput value={typeof shot.zoom === 'object' ? shot.zoom.h : (shot.zoom ?? 0)} step={0.05} min={0} max={5} onChange={(zoom) => set({ zoom: zoom || undefined }, 'zoom')} />
      </Field>
      <Field label="Drift / s">
        <NumberInput value={shot.drift ?? 0.015} step={0.005} min={0} max={0.2} onChange={(drift) => set({ drift }, 'drift')} />
      </Field>
      <Check value={!!shot.locked} onChange={(locked) => set({ locked }, 'locked')} label="Locked off (no hand-held float)" />
      <div className="iactions">
        {index > 0 && (
          <button
            className="btn small danger"
            onClick={() => {
              onChange((p) => updateShot(p, scene, index, null));
              onSelect({ kind: 'scene', scene });
            }}
          >
            Delete shot
          </button>
        )}
      </div>
    </Group>
  );
}

function BeatPanel({ project, scene, index, onChange, onSelect }: { project: Project; scene: number; index: number; onChange: Change; onSelect(s: Selection): void }) {
  const sc = project.scenes[scene];
  const lang = project.settings.language;
  const beats = sceneBeats(sc, lang);
  const beat = beats[index];
  if (!beat) return <p className="help">This pop-up no longer exists.</p>;
  const write = (next: Beat[] , key: string) => onChange((p) => updateScene(p, scene, (s) => withBeats(s, lang, next)), `beat:${scene}:${index}:${key}`);
  const set = (field: string, value: unknown) => write(beats.map((b, i) => (i === index ? ({ ...b, [field]: value } as Beat) : b)), field);
  const found = sc.narration.toLowerCase().includes(beat.cue.toLowerCase().trim()) && beat.cue.trim() !== '';
  return (
    <Group title={`Pop-up · ${beat.kind}`}>
      <Field label="Appears on" hint="a phrase of the narration: the pop-up starts when it is spoken">
        <Text value={beat.cue} onChange={(v) => set('cue', v)} />
      </Field>
      {!found && <p className="warn-text">Not found in the narration — it will not appear. Use words from the scene's narration.</p>}
      {Object.entries(beat)
        .filter(([k]) => k !== 'cue' && k !== 'kind')
        .map(([k, v]) =>
          Array.isArray(v) ? (
            <Field key={k} label={k} hint="one per line">
              <Text area value={(v as string[]).join('\n')} onChange={(s) => set(k, s.split('\n'))} />
            </Field>
          ) : typeof v === 'number' ? (
            <Field key={k} label={k}>
              <NumberInput value={v} step={1} onChange={(n) => set(k, n)} />
            </Field>
          ) : (
            <Field key={k} label={k}>
              <Text area={String(v).length > 40} value={String(v ?? '')} onChange={(s) => set(k, s)} />
            </Field>
          ),
        )}
      <p className="help">Facts must come from the episode's sources.</p>
      <div className="iactions">
        <button
          className="btn small danger"
          onClick={() => {
            write(beats.filter((_, i) => i !== index), 'del');
            onSelect({ kind: 'scene', scene });
          }}
        >
          Delete pop-up
        </button>
      </div>
    </Group>
  );
}

/** Inspector for timeline items (elements, shots, acting, pop-ups). Scenes use PropertiesPanel. */
export function Inspector({ project, timeline, time, selection, onSelect, onChange }: Props) {
  const vertical = project.settings.aspect === '9:16';
  const scene = project.scenes[selection.scene];
  const span = timeline.spans[selection.scene];
  const spec = scene?.spec;
  const fox = foxOf(spec);
  const ids = spec ? spec.elements.filter((e) => e.type !== 'fox').map((e) => e.id) : [];
  const kNow = span ? Math.max(0, Math.min(scene.authoredDuration, toAuthored(span, time))) : 0;
  const back = (
    <button className="linkish" onClick={() => onSelect({ kind: 'scene', scene: selection.scene })}>
      ← Scene {selection.scene + 1} · {scene?.title}
    </button>
  );

  let body: React.ReactNode = null;
  if (selection.kind === 'element' && spec) {
    const el = spec.elements.find((e) => e.id === selection.id);
    if (el?.type === 'fox') body = <FoxPanel fox={el as FoxElement} scene={selection.scene} vertical={vertical} onChange={onChange} onSelect={onSelect} kNow={kNow} ids={ids} />;
    else if (el) body = <ElementPanel el={el} scene={selection.scene} vertical={vertical} onChange={onChange} onSelect={onSelect} specLen={scene.authoredDuration} media={project.media ?? []} />;
    if (el)
      body = (
        <>
          {body}
          <LayerPanel el={el} spec={spec} scene={selection.scene} onChange={onChange} />
        </>
      );
  } else if (selection.kind === 'shot' && spec?.camera[selection.index]) {
    body = <ShotPanel shot={spec.camera[selection.index]} index={selection.index} scene={selection.scene} vertical={vertical} ids={ids} onChange={onChange} onSelect={onSelect} />;
  } else if (selection.kind === 'action' && fox?.actions?.[selection.index]) {
    body = <ActionPanel act={fox.actions[selection.index]} index={selection.index} scene={selection.scene} onChange={onChange} onSelect={onSelect} />;
  } else if (selection.kind === 'key' && fox) {
    body = <KeyPanel fox={fox} track={selection.track} index={selection.index} scene={selection.scene} onChange={onChange} onSelect={onSelect} ids={ids} />;
  } else if (selection.kind === 'beat') {
    body = <BeatPanel project={project} scene={selection.scene} index={selection.index} onChange={onChange} onSelect={onSelect} />;
  }

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="inspector-head">
        {back}
        <span className="muted small">{countWords(scene?.narration ?? '')} words</span>
      </div>
      {body ?? <p className="help">Select something on the timeline.</p>}
    </aside>
  );
}
