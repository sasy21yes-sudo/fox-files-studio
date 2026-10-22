import type { SceneSpec } from '../../scene/spec';
import { FILE_SPEC } from './file';

/** Hand-coded scenes that also exist as data (scene/spec.ts), by scene id. */
export const SPECS: Record<string, SceneSpec> = {
  file: FILE_SPEC,
};
