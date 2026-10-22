/**
 * Browser side of "Generate image": the dev server (tools/vite/localImage.ts)
 * forwards the prompt to the local ComfyUI. In a static build there is no such
 * endpoint and the image box only offers importing files.
 */

export type ImageStyle = 'cartoon' | 'sketch' | 'poster';
export type ImageAspect = '16:9' | '9:16' | '1:1';

export const IMAGE_STYLES: Record<ImageStyle, string> = {
  cartoon: '1930s cartoon',
  sketch: 'Ink & wash sketch',
  poster: '1940s poster',
};

export interface ImageStatus {
  available: boolean;
  devServer: boolean;
  url?: string;
}

export async function imageStatus(): Promise<ImageStatus> {
  try {
    const r = await fetch('/api/image/status');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { available: false, devServer: false };
    return { ...((await r.json()) as { available: boolean; url: string }), devServer: true };
  } catch {
    return { available: false, devServer: false };
  }
}

export async function generateImage(
  req: { prompt: string; style: ImageStyle; aspect: ImageAspect; seed?: number },
  signal?: AbortSignal,
): Promise<{ blob: Blob; seed: number; seconds: number }> {
  const r = await fetch('/api/image/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal });
  if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) {
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return { blob: await r.blob(), seed: Number(r.headers.get('X-Seed')), seconds: Number(r.headers.get('X-Seconds')) };
}
