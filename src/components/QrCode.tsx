import { LoadedImage } from './LoadedImage';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function QrCode({
  value,
  label,
  size = 'large',
}: {
  value: string;
  label: string;
  size?: 'medium' | 'large';
}) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let active = true;
    setSrc('');
    void QRCode.toDataURL(value, {
      width: 640,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).then((url) => {
      if (active) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [value]);
  return (
    <div className={`qr-block ${size}`} aria-busy={!src}>
      {src ? <LoadedImage src={src} alt={label} /> : <span>Preparing QR…</span>}
    </div>
  );
}
