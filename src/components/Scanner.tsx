import { useEffect, useRef, useState } from 'react';
import { Camera, QrCode, Search } from 'lucide-react';
import { useStation } from '../context';
import { Button, Notice } from './Ui';

export function Scanner({
  onLookup,
  busy,
  error,
}: {
  onLookup: (value: string) => void;
  busy: boolean;
  error?: string;
}) {
  const { prefs } = useStation();
  const [camera, setCamera] = useState(false),
    [cameraError, setCameraError] = useState(''),
    [identifier, setIdentifier] = useState('');
  const video = useRef<HTMLVideoElement>(null),
    onRead = useRef(onLookup);
  onRead.current = onLookup;
  useEffect(() => {
    if (!camera) return;
    let cancelled = false,
      controls: { stop: () => void } | undefined;
    let latched = false;
    void import('@zxing/browser')
      .then(async ({ BrowserQRCodeReader }) => {
        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromVideoDevice(
          prefs.cameraId || undefined,
          video.current!,
          (result) => {
            if (result && !cancelled && !latched) {
              latched = true;
              setCamera(false);
              onRead.current(result.getText());
            }
          },
        );
        if (cancelled) controls.stop();
      })
      .catch(() => {
        if (!cancelled) {
          setCamera(false);
          setCameraError('Camera unavailable. Allow camera access or enter the ticket ID below.');
        }
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [camera, prefs.cameraId]);
  return (
    <div className="scanner-page">
      <div className="scanner-heading">
        <QrCode size={48} aria-hidden="true" />
        <h1>Scan customer ticket</h1>
      </div>
      {camera ? (
        <div className="camera-view">
          <video ref={video} muted playsInline autoPlay />
          <Button onClick={() => setCamera(false)}>Stop camera</Button>
        </div>
      ) : (
        <Button
          primary
          onClick={() => {
            setCameraError('');
            setCamera(true);
          }}
          disabled={busy}
        >
          <Camera size={20} />
          Start camera
        </Button>
      )}
      <form
        className="lookup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (identifier.trim()) onLookup(identifier.trim());
        }}
      >
        <label className="sr-only" htmlFor="ticket-lookup">
          Ticket ID or QR link
        </label>
        <input
          id="ticket-lookup"
          placeholder="Ticket ID or QR link"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="off"
        />
        <Button type="submit" busy={busy} disabled={!identifier.trim()} aria-label="Find ticket">
          <Search size={18} />
          <span>Find ticket</span>
        </Button>
      </form>
      <Notice>{error || cameraError}</Notice>
    </div>
  );
}
