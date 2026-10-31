import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Aperture, Download as DownloadIcon, ImageOff } from 'lucide-react';
import type { EventConfig } from '../../shared/types';
import { api } from '../lib/api';
import { Empty } from '../components/Ui';

type Delivery = {
  event: EventConfig;
  code: string;
  photos: { id: string; number: number; filename: string; width: number; height: number }[];
};
export default function Download() {
  const { token } = useParams(),
    [delivery, setDelivery] = useState<Delivery | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<Delivery>(`/delivery/${token}`)
      .then((result) => {
        if (active) setDelivery(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (error)
    return (
      <main className="customer-page">
        <Empty icon={<ImageOff size={40} />} title="Download unavailable">
          <p>{error}</p>
        </Empty>
      </main>
    );
  if (!delivery)
    return (
      <main className="customer-page">
        <p>Opening your photos…</p>
      </main>
    );
  const { event, photos } = delivery;
  return (
    <main
      className="customer-page"
      style={
        {
          '--brand-primary': event.primaryColor,
          '--accent': event.accentColor,
        } as React.CSSProperties
      }
    >
      <header>
        <Aperture size={29} />
        <div>
          <strong>{event.eventName || 'FrameRelay'}</strong>
        </div>
      </header>
      <section>
        <h1>A moment to keep.</h1>
        <p>{delivery.code}</p>
        <div className={`download-gallery ${photos.length === 1 ? 'single' : ''}`}>
          {photos.map((photo) => (
            <article key={photo.id}>
              <img
                src={`/api/delivery/${token}/${photo.id}`}
                alt={`Your final image ${photo.number}`}
              />
              <a
                className="button primary"
                href={`/api/delivery/${token}/${photo.id}?download=1`}
                download={photo.filename}
              >
                <DownloadIcon size={18} />
                Download photo{photos.length > 1 ? ` ${photo.number}` : ''}
              </a>
            </article>
          ))}
        </div>
        <p className="field-hint">
          On iPhone or iPad, use the downloaded file’s Share menu to save it to Photos.
        </p>
      </section>
      {event.footerText ? <footer>{event.footerText}</footer> : null}
    </main>
  );
}
