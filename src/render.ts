import { renderImage } from '@image-ultra/react';

declare global {
  interface Window {
    framerelayRender?: (
      source: string,
      recipe: unknown,
    ) => Promise<{ data: string; width: number; height: number; downscaled: boolean }>;
  }
}
window.framerelayRender = async (source, recipe) => {
  const result = await renderImage(source, recipe, {
    mimeType: 'image/jpeg',
    quality: 0.96,
    keepMetadata: false,
  });
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(result.blob);
  });
  return { data, width: result.width, height: result.height, downscaled: result.downscaled };
};
