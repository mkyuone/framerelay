import type { EditState } from '@image-ultra/react';

/** All station edits use one of the two photo-print orientations. */
export function constrainCrop(
  state: EditState,
  sourceWidth: number,
  sourceHeight: number,
): EditState {
  const geometry = state.geometry;
  const width = geometry.rotation % 180 ? sourceHeight : sourceWidth;
  const height = geometry.rotation % 180 ? sourceWidth : sourceHeight;
  const crop = geometry.crop;
  const aspect = geometry.cropAspect;
  const allowed =
    aspect !== null && (Math.abs(aspect - 3 / 2) < 1e-6 || Math.abs(aspect - 2 / 3) < 1e-6);
  if (
    allowed &&
    geometry.cropShape === 'rect' &&
    crop &&
    Math.abs(crop.width - crop.height * aspect) <= 1
  )
    return state;
  const next = structuredClone(state);
  const ratio = allowed
    ? aspect
    : (crop ? crop.width >= crop.height : width >= height)
      ? 3 / 2
      : 2 / 3;
  const bounds = crop ?? { x: 0, y: 0, width, height };
  const cropWidth = Math.min(bounds.width, bounds.height * ratio);
  const cropHeight = cropWidth / ratio;
  next.geometry.cropAspect = ratio;
  next.geometry.cropShape = 'rect';
  next.geometry.crop = {
    x: bounds.x + (bounds.width - cropWidth) / 2,
    y: bounds.y + (bounds.height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
  return next;
}
