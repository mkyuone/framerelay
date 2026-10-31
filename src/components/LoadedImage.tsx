import { forwardRef, useEffect, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import { ImageOff, LoaderCircle } from 'lucide-react';

type Props = ImgHTMLAttributes<HTMLImageElement> & { src: string; onReady?: () => void };
export const LoadedImage = forwardRef<HTMLImageElement, Props>(function LoadedImage(
  { src, onLoad, onError, onReady, style, ...props },
  ref,
) {
  const [loaded, setLoaded] = useState('');
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const retry = () => {
      if (failed === src) {
        setFailed('');
        setAttempt((value) => value + 1);
      }
    };
    window.addEventListener('framerelay:reconnected', retry);
    return () => window.removeEventListener('framerelay:reconnected', retry);
  }, [failed, src]);
  const ready = loaded === src && failed !== src;
  return (
    <>
      <img
        {...props}
        key={`${src}.${attempt}`}
        ref={ref}
        src={src}
        style={{ ...style, visibility: ready ? 'visible' : 'hidden' }}
        onLoad={(event) => {
          const element = event.currentTarget;
          onLoad?.(event);
          void element
            .decode()
            .then(() => {
              setLoaded(src);
              setFailed('');
              onReady?.();
            })
            .catch(() => setFailed(src));
        }}
        onError={(event) => {
          setFailed(src);
          onError?.(event);
        }}
      />
      {!ready ? (
        <span
          className="asset-loading"
          role="status"
          aria-label={failed === src ? 'Image unavailable' : 'Loading image'}
        >
          {failed === src ? <ImageOff size={24} /> : <LoaderCircle size={24} className="spin" />}
        </span>
      ) : null}
    </>
  );
});
