import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Part } from './providers';
import * as store from './store';
import type { Video } from './types';

/** A video's saved still frames as image parts for the model, optionally only those up to `maxT` seconds. */
export async function frameParts(video: Video, maxT = Infinity): Promise<Part[]> {
  const parts = await Promise.all(
    video.frames
      .filter((f) => f.t <= maxT)
      .map(async (f): Promise<Part | undefined> => {
        try {
          const data = await readFile(join(store.framesDir(video.id), f.file));
          return { type: 'image', data, label: `Frame at ${f.t.toFixed(1)}s:` };
        } catch {
          return undefined;
        }
      }),
  );
  return parts.filter((p): p is Part => Boolean(p));
}
