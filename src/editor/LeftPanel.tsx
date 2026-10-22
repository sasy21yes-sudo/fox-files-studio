import { useState } from 'react';
import type { Project } from '../types';
import type { Timeline } from '../animation/timeline';
import { SceneList } from '../components/SceneList';
import { ELEMENTS, ELEMENT_PLACE, type ElementDef } from '../scene/elements';
import type { ElementType, SceneElement } from '../scene/spec';
import { newScene } from '../data/project';
import { deleteScene, duplicateScene, insertScene, moveScene, toAuthored, uniqueId, updateSpec, type Selection } from './model';

type Change = (fn: (p: Project) => Project, key?: string) => void;

interface Props {
  project: Project;
  timeline: Timeline;
  time: number;
  selection: Selection;
  current: number;
  onSelect(s: Selection): void;
  onSelectScene(i: number): void;
  onChange: Change;
}

const CATEGORY: Record<ElementDef['category'], string> = { set: 'Sets', prop: 'Props', effect: 'Effects', character: 'Characters' };

/** Media pool of the Edit page: the episode's scenes and the element library. */
export function LeftPanel({ project, timeline, time, selection, current, onSelect, onSelectScene, onChange }: Props) {
  const [tab, setTab] = useState<'scenes' | 'elements'>('scenes');
  const si = selection.scene;
  const scene = project.scenes[si];
  const span = timeline.spans[si];

  const addElement = (type: Exclude<ElementType, 'fox'>) => {
    if (!scene?.spec || !span) return;
    const def = ELEMENTS[type];
    const k = Math.max(0, Math.min(scene.authoredDuration, toAuthored(span, time)));
    const id = uniqueId(scene.spec, type);
    const params: Record<string, unknown> = type === 'puff' || type === 'stamp' ? { at: Math.round(k * 100) / 100 } : {};
    const el: SceneElement = { id, type, label: def.label, ...ELEMENT_PLACE[type], ...(Object.keys(params).length ? { params } : {}) };
    onChange((p) =>
      updateSpec(p, si, (spec) => {
        const els = [...spec.elements];
        // Sets go behind everything; the rest just behind Agent Fox, so he stays in front.
        const fox = els.findIndex((e) => e.type === 'fox');
        const at = def.category === 'set' ? 0 : fox >= 0 ? fox : els.length;
        els.splice(at, 0, el);
        return { ...spec, elements: els };
      }),
    );
    onSelect({ kind: 'element', scene: si, id });
  };

  return (
    <aside className="left-panel" aria-label="Media pool">
      <div className="tabs">
        <button className={tab === 'scenes' ? 'on' : ''} onClick={() => setTab('scenes')}>
          Scenes
        </button>
        <button className={tab === 'elements' ? 'on' : ''} onClick={() => setTab('elements')}>
          Elements
        </button>
      </div>

      {tab === 'scenes' && (
        <>
          <div className="scene-tools">
            <button
              className="btn small"
              title="Add a new scene after the selected one"
              onClick={() => {
                onChange((p) => insertScene(p, si + 1, newScene(`Scene ${p.scenes.length + 1}`)));
                onSelect({ kind: 'scene', scene: si + 1 });
              }}
            >
              + Scene
            </button>
            <button className="btn small ghost" title="Duplicate" onClick={() => onChange((p) => duplicateScene(p, si))}>
              ⧉
            </button>
            <button className="btn small ghost" title="Move earlier" disabled={si === 0} onClick={() => { onChange((p) => moveScene(p, si, si - 1)); onSelect({ kind: 'scene', scene: si - 1 }); }}>
              ↑
            </button>
            <button className="btn small ghost" title="Move later" disabled={si >= project.scenes.length - 1} onClick={() => { onChange((p) => moveScene(p, si, si + 1)); onSelect({ kind: 'scene', scene: si + 1 }); }}>
              ↓
            </button>
            <button
              className="btn small ghost danger"
              title="Delete the selected scene"
              disabled={project.scenes.length <= 1}
              onClick={() => {
                onChange((p) => deleteScene(p, si));
                onSelect({ kind: 'scene', scene: Math.max(0, si - 1) });
              }}
            >
              🗑
            </button>
          </div>
          <SceneList project={project} timeline={timeline} selected={si} current={current} onSelect={onSelectScene} />
        </>
      )}

      {tab === 'elements' && (
        <div className="element-lib">
          {!scene?.spec ? (
            <p className="help">Scene {si + 1} is hand-coded: elements can be added to scenes made of data (new scenes, or scene 1).</p>
          ) : (
            <p className="help">Adds to scene {si + 1} · {scene.title}. Puffs and stamps start at the playhead.</p>
          )}
          {(['set', 'prop', 'effect'] as const).map((cat) => (
            <section key={cat}>
              <h3>{CATEGORY[cat]}</h3>
              {(Object.entries(ELEMENTS) as [Exclude<ElementType, 'fox'>, ElementDef][])
                .filter(([, d]) => d.category === cat)
                .map(([type, d]) => (
                  <button key={type} className="lib-item" disabled={!scene?.spec} onClick={() => addElement(type)} title={d.description}>
                    <span className="lib-name">{d.label}</span>
                    <span className="lib-desc">{d.description}</span>
                  </button>
                ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
