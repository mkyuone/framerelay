import { memo, useEffect, useRef, useState } from 'react';

/** A display-only JPEG highlight warning; never changes the stored photograph. */
export const ExposureImage = memo(function ExposureImage({
  src,
  alt,
  zebra = false,
  loading,
}: {
  src: string;
  alt: string;
  zebra?: boolean;
  loading?: 'lazy' | 'eager';
}) {
  const image = useRef<HTMLImageElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    const photo = image.current,
      overlay = canvas.current;
    if (!zebra || !photo || !overlay || loaded !== src) return;
    const ratio = Math.min(1, 1600 / Math.max(photo.naturalWidth, photo.naturalHeight));
    overlay.width = Math.max(1, Math.round(photo.naturalWidth * ratio));
    overlay.height = Math.max(1, Math.round(photo.naturalHeight * ratio));
    const context = overlay.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(photo, 0, 0, overlay.width, overlay.height);
    const pixels = context.getImageData(0, 0, overlay.width, overlay.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const brightness =
        0.2126 * pixels.data[i] + 0.7152 * pixels.data[i + 1] + 0.0722 * pixels.data[i + 2];
      const x = (i / 4) % overlay.width,
        y = Math.floor(i / 4 / overlay.width);
      const stripe = (x + y) % 20 < 10 ? 255 : 0;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = stripe;
      pixels.data[i + 3] = brightness >= 250 ? 220 : 0;
    }
    context.putImageData(pixels, 0, 0);
  }, [zebra, src, loaded]);
  return (
    <>
      <img
        ref={image}
        src={src}
        alt={alt}
        loading={loading}
        draggable={false}
        onLoad={() => setLoaded(src)}
      />
      {zebra ? <canvas ref={canvas} className="zebra-overlay" aria-hidden="true" /> : null}
    </>
  );
});
