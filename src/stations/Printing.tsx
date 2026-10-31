import { useEffect, useState } from 'react';
import { Check, Download, Printer, RotateCcw, Search } from 'lucide-react';
import { Modal } from '@mantine/core';
import type { Photo, Ticket } from '../../shared/types';
import { useStation } from '../context';
import { api, patch, photoUrl } from '../lib/api';
import { useLocal, usePolling, useTask } from '../lib/hooks';
import { StationLayout } from '../components/StationLayout';
import { Button, Empty, Notice } from '../components/Ui';

export default function Printing() {
  const { event, prefs } = useStation(),
    queue = usePolling(() => api<Ticket[]>('/queue')),
    task = useTask(),
    [selectedId, setSelectedId] = useLocal<string | null>(
      `framerelay.v1.${event.id}.printing.current`,
      null,
    ),
    [search, setSearch] = useState(''),
    [tab, setTab] = useState<'pending' | 'completed'>(
      prefs.showCompleted ? 'completed' : 'pending',
    ),
    [reprint, setReprint] = useState<Photo | null>(null);
  const tickets = queue.value ?? [],
    finals = (t: Ticket) => t.photos.filter((p) => p.chosen),
    complete = (t: Ticket) => finals(t).every((p) => p.printed),
    pending = tickets.filter((t) => !complete(t)),
    selected = tickets.find((t) => t.id === selectedId) ?? null;
  useEffect(() => {
    setTab(prefs.showCompleted ? 'completed' : 'pending');
  }, [prefs.showCompleted]);
  const filtered = tickets.filter(
    (t) =>
      (tab === 'completed' ? complete(t) : !complete(t)) &&
      t.code.toLowerCase().includes(search.toLowerCase()),
  );
  async function mark(photo: Photo, printed: boolean) {
    await task.run(async () => {
      const ticket = await patch<Ticket>(`/photos/${photo.id}/print`, {
        printed,
        revision: photo.printRevision,
      });
      queue.setValue(
        (current) => current?.map((t) => (t.id === ticket.id ? ticket : t)) ?? [ticket],
      );
    }, photo.id);
  }
  return (
    <StationLayout
      showCustomerContext={false}
      error={queue.error}
      status={`${pending.length} print job${pending.length === 1 ? '' : 's'} pending`}
    >
      {!event.printEnabled ? (
        <Empty icon={<Printer size={44} />} title="Printing is disabled">
          <p>This event uses digital delivery only.</p>
        </Empty>
      ) : (
        <div className={`printing-workspace ${prefs.queueDensity}`}>
          <aside className="print-queue">
            <div className="queue-heading">
              <h1>Print queue</h1>
              <span>{pending.length} pending</span>
            </div>
            <div className="queue-tabs">
              <button
                className={tab === 'pending' ? 'active' : ''}
                onClick={() => setTab('pending')}
              >
                Pending
              </button>
              <button
                className={tab === 'completed' ? 'active' : ''}
                onClick={() => setTab('completed')}
              >
                Completed
              </button>
            </div>
            <label className="queue-search">
              <Search size={17} />
              <input
                placeholder="Find print job"
                aria-label="Find print job"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="queue-list">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  className={`queue-ticket ${selected?.id === t.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div>
                    <strong>{t.code}</strong>
                    <span>
                      {t.submittedAt
                        ? new Date(t.submittedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                    </span>
                  </div>
                  <div>
                    <span>
                      {finals(t).length} image{finals(t).length === 1 ? '' : 's'}
                    </span>
                    <span>
                      {finals(t).filter((p) => p.printed).length}/{finals(t).length} printed
                    </span>
                  </div>
                </button>
              ))}
              {!filtered.length ? (
                <p className="queue-empty">
                  {search
                    ? 'No matching print jobs.'
                    : tab === 'pending'
                      ? 'The queue is clear.'
                      : 'No completed prints yet.'}
                </p>
              ) : null}
            </div>
          </aside>
          <section
            className={`print-detail ${prefs.thumbnailSize === 'large' ? 'large-thumbnails' : ''}`}
          >
            <Notice>{task.error}</Notice>
            {selected ? (
              <>
                <div className="workspace-toolbar">
                  <div>
                    <h1>Print photos</h1>
                    <span>
                      {event.printWidth} × {event.printHeight} in · {event.copies}{' '}
                      {event.copies === 1 ? 'copy' : 'copies'} per image
                    </span>
                  </div>
                  {complete(selected) ? (
                    <span className="success-label">
                      <Check size={18} />
                      All prints released
                    </span>
                  ) : null}
                </div>
                <div className="print-files">
                  {finals(selected).map((photo) => (
                    <article className="print-file" key={photo.id}>
                      <img src={photoUrl(photo.id, 'final')} alt={`Final image ${photo.number}`} />
                      <div className="print-file-body">
                        <strong>Image {String(photo.number).padStart(2, '0')}</strong>
                        <span className="filename">{photo.finalFilename}</span>
                        <small>
                          {photo.finalWidth} × {photo.finalHeight} px · {event.copies}{' '}
                          {event.copies === 1 ? 'copy' : 'copies'}
                        </small>
                        <div className="print-file-actions">
                          <a className="button" href={`/api/photos/${photo.id}/download`} download>
                            <Download size={18} />
                            Download JPEG
                          </a>
                          {photo.printed ? (
                            <>
                              <span className="success-label">
                                <Check size={17} />
                                Printed
                              </span>
                              <Button
                                onClick={() => void mark(photo, false)}
                                busy={task.busy && task.operation === photo.id}
                                blocked={task.busy && task.operation !== photo.id}
                              >
                                Undo
                              </Button>
                              <Button onClick={() => setReprint(photo)} blocked={task.busy}>
                                <RotateCcw size={16} />
                                Reprint
                              </Button>
                            </>
                          ) : (
                            <Button
                              primary
                              onClick={() => void mark(photo, true)}
                              busy={task.busy && task.operation === photo.id}
                              blocked={task.busy && task.operation !== photo.id}
                            >
                              Mark printed
                            </Button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <Empty
                icon={<Printer size={44} />}
                title={pending.length ? 'Choose a print job.' : 'All caught up.'}
              >
                <p>
                  {pending.length
                    ? 'Select a job from the queue.'
                    : 'Final photos will appear here after selection.'}
                </p>
              </Empty>
            )}
          </section>
        </div>
      )}
      <Modal opened={!!reprint} onClose={() => setReprint(null)} title="Request a reprint" centered>
        <p>
          Put image {reprint?.number} back in the pending queue? Its JPEG stays available for
          download.
        </p>
        <div className="modal-actions">
          <Button onClick={() => setReprint(null)}>Back</Button>
          <Button
            primary
            onClick={() => {
              if (reprint) void mark(reprint, false);
              setReprint(null);
            }}
          >
            Request reprint
          </Button>
        </div>
      </Modal>
    </StationLayout>
  );
}
