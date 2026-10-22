import { useCallback, useMemo, useRef, useState } from 'react';

const LIMIT = 200;
/** Edits with the same key within this window merge into one undo step (typing, dragging). */
const COALESCE_MS = 900;

export interface History<T> {
  value: T;
  /** Apply an edit. `key` groups rapid edits of the same thing into one undo step. */
  set(update: T | ((prev: T) => T), key?: string): void;
  /** Replace the value without an undo step (loading another project). */
  reset(value: T): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Undo/redo over an immutable value (the project). */
export function useHistory<T>(initial: () => T): History<T> {
  const [state, setState] = useState(() => ({ past: [] as T[], present: initial(), future: [] as T[] }));
  const last = useRef<{ key?: string; at: number }>({ at: 0 });

  const set = useCallback((update: T | ((prev: T) => T), key?: string) => {
    setState((s) => {
      const next = typeof update === 'function' ? (update as (p: T) => T)(s.present) : update;
      if (Object.is(next, s.present)) return s;
      const now = performance.now();
      const merge = key !== undefined && last.current.key === key && now - last.current.at < COALESCE_MS;
      last.current = { key, at: now };
      return {
        past: merge ? s.past : [...s.past, s.present].slice(-LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const reset = useCallback((value: T) => {
    last.current = { at: 0 };
    setState({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    last.current = { at: 0 };
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    last.current = { at: 0 };
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  return useMemo(
    () => ({ value: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }),
    [state, set, reset, undo, redo],
  );
}
