import { createEditState, parseEditState } from '@image-ultra/react';
import { demand } from './store.ts';
import { constrainCrop } from '../shared/crop.ts';

// Preserve the native Adjust, Finetune, Filter and Sticker tools without allowing
// server exports to fetch URLs embedded in untrusted edit recipes.
export function safeRecipe(input: unknown, width: number, height: number) {
  const parsed = parseEditState(input),
    state = createEditState();
  state.geometry = parsed.geometry;
  state.finetune = parsed.finetune;
  state.levels = parsed.levels;
  state.curves = parsed.curves;
  state.filter = parsed.filter;
  state.annotations = parsed.annotations.filter((shape) => shape.type === 'image');
  demand(state.annotations.length <= 50, 'Use at most 50 stickers per photo.', 400);
  const assets = new Map<string, (typeof parsed.assets)[string]>();
  let totalBytes = 0;
  for (const shape of state.annotations) {
    if (shape.type !== 'image' || assets.has(shape.assetId)) continue;
    const asset = parsed.assets[shape.assetId];
    demand(asset, 'A sticker is missing. Remove it and add it again.', 400);
    const match = /^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(asset.src);
    demand(
      match && match[2].length <= 6 * 1024 * 1024,
      'Use a PNG, JPEG or WebP sticker smaller than 4 MB.',
      400,
    );
    const bytes = Buffer.from(match[2], 'base64');
    const image =
      (match[1].toLowerCase() === 'png' &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (/^jpe?g$/i.test(match[1]) && bytes[0] === 0xff && bytes[1] === 0xd8) ||
      (match[1].toLowerCase() === 'webp' &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP');
    totalBytes += bytes.length;
    demand(
      image && bytes.length <= 4 * 1024 * 1024 && totalBytes <= 8 * 1024 * 1024,
      'Use valid image stickers totalling at most 8 MB.',
      400,
    );
    assets.set(shape.assetId, asset);
  }
  state.assets = Object.fromEntries(assets);
  const crop = state.geometry.crop,
    w = state.geometry.rotation % 180 ? height : width,
    h = state.geometry.rotation % 180 ? width : height;
  demand(
    !crop ||
      (crop.x >= -1 &&
        crop.y >= -1 &&
        crop.width > 0 &&
        crop.height > 0 &&
        crop.x + crop.width <= w + 2 &&
        crop.y + crop.height <= h + 2),
    'The crop must stay inside the original photo.',
    400,
  );
  return constrainCrop(state, width, height);
}
