import { useEffect, useSyncExternalStore } from 'react';
import type { Project } from '../types';
import { loadProjectMedia, mediaVersion, onMediaChange } from './store';

/** Changes whenever another image finishes decoding (redraw anything that shows pictures). */
export const useMediaVersion = () => useSyncExternalStore(onMediaChange, mediaVersion);

/** Keep the project's images decoded for the preview. */
export function useProjectMedia(project: Project) {
  const ids = (project.media ?? []).map((m) => m.id).join(',');
  useEffect(() => {
    void loadProjectMedia(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
}
