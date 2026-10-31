import { LoadedImage } from '../components/LoadedImage';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Modal } from '@mantine/core';
import { Check, CheckCircle2, Columns2, Images, LoaderCircle, Printer, X } from 'lucide-react';
import type { Photo, Ticket } from '../../shared/types';
import { useStation } from '../context';
import { api, patch, photoUrl, post } from '../lib/api';
import { useLocal, usePageSize, useTask } from '../lib/hooks';
import { useCurrentTicket } from '../lib/ticket';
import { StationLayout, type HeaderAction } from '../components/StationLayout';
import { Scanner } from '../components/Scanner';
import { PhotoGrid } from '../components/PhotoGrid';
import { QrCode } from '../components/QrCode';
import { Button, Empty, Notice } from '../components/Ui';
import type { PhotoEditorHandle } from '../components/PhotoEditor';
import { PhotoInspector } from '../components/PhotoInspector';

const PhotoEditor = lazy(() => import('../components/PhotoEditor'));
export default function Selection() {
  const { event, prefs } = useStation(),
    { ticket, setTicket, loadError } = useCurrentTicket(),
    task = useTask();
  const [step, setStep] = useLocal<'choose' | 'edit' | 'review'>(
      `framerelay.v1.${event.id}.selection.step`,
      'choose',
    ),
    [editId, setEditId] = useLocal<string | null>(`framerelay.v1.${event.id}.selection.edit`, null),
    [previousId, setPreviousId] = useLocal<string | null>(
      `framerelay.v1.${event.id}.selection.previous`,
      null,
    );
  const [compareMode, setCompareMode] = useState(false),
    [compareIds, setCompareIds] = useState<string[]>([]),
    [compareOpen, setCompareOpen] = useState(false),
    [status, setStatus] = useState(''),
    [claimed, setClaimed] = useState(false),
    [claimError, setClaimError] = useState('');
  const editor = useRef<PhotoEditorHandle>(null),
    pageSize = usePageSize(prefs.thumbnailSize === 'large');
  useEffect(() => {
    if (!ticket || ticket.status !== 'ready') {
      setClaimed(false);
      setClaimError('');
      return;
    }
    const id = ticket.id;
    let active = true;
    const renew = () =>
      post(`/tickets/${id}/claim`)
        .then(() => {
          if (active) {
            setClaimed(true);
            setClaimError('');
          }
        })
        .catch((e) => {
          if (active) {
            setClaimed(false);
            setClaimError(e.message);
          }
        });
    void renew();
    const timer = setInterval(() => void renew(), 25_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ticket?.id, ticket?.status]);
  const chosen =
      ticket?.photos.filter((p) => p.chosen && !p.excludedSelection && !p.excludedPhotography) ??
      [],
    editable = chosen.find((p) => p.id === editId) ?? chosen[0],
    index = chosen.findIndex((p) => p.id === editable?.id);
  const printsReady = chosen.length > 0 && chosen.every((photo) => photo.printed);
  const visible = ticket?.photos ?? [];
  async function lookup(identifier: string) {
    await task.run(async () => {
      const result = await post<Ticket>('/tickets/lookup', { identifier });
      setTicket(result);
      setStep('choose');
      setEditId(null);
      setCompareIds([]);
      setCompareMode(false);
    });
  }
  async function updatePhoto(photo: Photo, body: unknown) {
    await task.run(async () => setTicket(await patch<Ticket>(`/photos/${photo.id}`, body)));
  }
  async function saveAndNext() {
    await task.run(async () => {
      if (!editor.current) throw new Error('The editor is still loading.');
      const result = await editor.current.save();
      setTicket(result);
      const next = chosen[index + 1];
      if (next) setEditId(next.id);
      else setStep('review');
      setStatus('');
    }, 'save');
  }
  async function back() {
    await task.run(async () => {
      if (step === 'edit') await editor.current?.flush();
      setStep('choose');
      setStatus('');
    }, 'back');
  }
  const ready = ticket?.status === 'ready',
    submitted = ticket?.status === 'submitted',
    waiting = ticket && !ready && !submitted;
  let action: HeaderAction | undefined, backAction: HeaderAction | undefined;
  if (submitted)
    action = {
      label: 'Finish customer',
      onClick: () => {
        setPreviousId(ticket.id);
        setTicket(null);
        setStep('choose');
        setStatus('');
      },
    };
  else if (waiting) action = { label: 'Return to scanning', onClick: () => setTicket(null) };
  else if (ready) {
    if (step === 'choose')
      action = {
        label: `Edit chosen photo${chosen.length === 1 ? '' : 's'}`,
        disabled: !chosen.length || !claimed,
        blocked: task.busy,
        onClick: () => {
          setEditId(chosen[0].id);
          setStep('edit');
        },
      };
    if (step === 'edit')
      action = {
        label: index === chosen.length - 1 ? 'Save and review' : 'Save and next',
        disabled: !claimed || !editable,
        onClick: () => void saveAndNext(),
        busy: task.busy && task.operation === 'save',
        blocked: task.busy && task.operation !== 'save',
      };
    if (step === 'review')
      action = {
        label: 'Submit final photos',
        disabled: !claimed || !chosen.length || chosen.some((p) => p.renderStatus !== 'ready'),
        onClick: () =>
          void task.run(async () => {
            setTicket(await post<Ticket>(`/tickets/${ticket.id}/submit`));
            setStatus('');
          }, 'submit'),
        busy: task.busy && task.operation === 'submit',
        blocked: task.busy && task.operation !== 'submit',
      };
    if (step !== 'choose')
      backAction = {
        label: 'Back to photos',
        onClick: () => void back(),
        busy: task.busy && task.operation === 'back',
        blocked: task.busy && task.operation !== 'back',
      };
    else
      backAction = {
        label: 'Scan another',
        blocked: task.busy,
        onClick: () =>
          void task.run(async () => {
            await post(`/tickets/${ticket.id}/release`);
            setTicket(null);
          }),
      };
  }
  return (
    <StationLayout
      ticket={ticket}
      action={action}
      back={backAction}
      edgeToEdge={!!ready && step === 'edit' && !!editable}
      status={
        step === 'edit' && editable
          ? `Image ${String(editable.number).padStart(2, '0')} · ${index + 1}/${chosen.length}${status ? ` · ${status}` : ''}`
          : status || undefined
      }
      error={loadError || claimError}
    >
      {!ticket ? (
        <>
          <Scanner onLookup={(value) => void lookup(value)} busy={task.busy} error={task.error} />
          {previousId ? (
            <div className="idle-folder">
              <Button
                className="quiet"
                onClick={() =>
                  void task.run(async () => setTicket(await api<Ticket>(`/tickets/${previousId}`)))
                }
              >
                Show previous download QR
              </Button>
            </div>
          ) : null}
        </>
      ) : submitted ? (
        <div
          className={`delivery-content ${event.printEnabled ? 'print-handoff' : 'digital-handoff'}`}
        >
          <div className="qr-title pickup-message">
            {event.printEnabled ? (
              <Printer size={32} className="pickup-icon" />
            ) : (
              <CheckCircle2 size={29} className="success-icon" />
            )}
            <h1>
              {event.printEnabled
                ? printsReady
                  ? 'Your prints are ready to collect.'
                  : 'Collect your prints later.'
                : event.digitalEnabled
                  ? 'Your digital photos are ready.'
                  : 'Your photos have been saved.'}
            </h1>
            <p>
              {event.printEnabled
                ? printsReady
                  ? 'Please collect them at the photo collection point.'
                  : 'Return to the photo collection point to pick up your prints.'
                : event.digitalEnabled
                  ? 'Scan to download your photos.'
                  : 'Thank you!'}
            </p>
          </div>
          {event.digitalEnabled && ticket.deliveryPath ? (
            event.printEnabled ? (
              <section className="digital-copy" aria-label="Optional digital copy">
                <div>
                  <h2>Digital copy</h2>
                  <p>Optional: scan to save a copy on your phone.</p>
                </div>
                <QrCode
                  value={`${location.origin}${ticket.deliveryPath}`}
                  label={`Download photos for ${ticket.code}`}
                  size="medium"
                />
              </section>
            ) : (
              <QrCode
                value={`${location.origin}${ticket.deliveryPath}`}
                label={`Download photos for ${ticket.code}`}
              />
            )
          ) : null}
        </div>
      ) : waiting ? (
        <Empty icon={<LoaderCircle className="spin" size={40} />} title="Waiting for photography">
          <p>
            {ticket.photos.length} photos received. This page will update when photography finishes.
          </p>
        </Empty>
      ) : step === 'choose' ? (
        <div className="selection-workspace">
          <div className="workspace-toolbar">
            <div>
              <h1>
                {compareMode
                  ? 'Compare photos'
                  : `Choose your final photo${event.selectionLimit > 1 ? 's' : ''}.`}
              </h1>
              <span>
                {compareMode
                  ? `Pick two photos · ${compareIds.length}/2`
                  : `${chosen.length} of ${event.selectionLimit} chosen`}
              </span>
            </div>
            <div className="toolbar-actions">
              <Button
                className="compare-open-button"
                disabled={compareMode && compareIds.length !== 2}
                onClick={() => {
                  if (compareMode) setCompareOpen(true);
                  else {
                    setCompareMode(true);
                    setCompareIds([]);
                  }
                }}
              >
                <Columns2 size={18} />
                <span className="compare-open-label">
                  <span className="label-size-reserve" aria-hidden="true">
                    Open comparison
                  </span>
                  <span>{compareMode ? 'Open comparison' : 'Compare'}</span>
                </span>
              </Button>
              {compareMode ? (
                <button
                  className="icon-button"
                  aria-label="Cancel comparison"
                  onClick={() => {
                    setCompareMode(false);
                    setCompareIds([]);
                  }}
                >
                  <X size={18} />
                </button>
              ) : null}
            </div>
          </div>
          <Notice>{task.error}</Notice>
          {visible.length ? (
            <PhotoGrid
              photos={visible}
              mode="selection"
              pageSize={pageSize}
              disabled={!claimed}
              pending={task.busy}
              onChoose={
                compareMode
                  ? undefined
                  : (p) => {
                      if (
                        event.selectionLimit > 1 &&
                        !p.chosen &&
                        chosen.length >= event.selectionLimit
                      ) {
                        task.setError(
                          `Choose up to ${event.selectionLimit} photo${event.selectionLimit === 1 ? '' : 's'}. Unchoose one first.`,
                        );
                        return;
                      }
                      void updatePhoto(p, { chosen: !p.chosen });
                    }
              }
              onExclude={(p) =>
                void updatePhoto(p, {
                  excludedSelection: !(p.excludedPhotography || p.excludedSelection),
                })
              }
              compareIds={compareIds}
              onCompareToggle={
                compareMode
                  ? (p) =>
                      setCompareIds((ids) =>
                        ids.includes(p.id) ? ids.filter((id) => id !== p.id) : [...ids, p.id],
                      )
                  : undefined
              }
            />
          ) : (
            <Empty icon={<Images size={40} />} title="No photos available" />
          )}
        </div>
      ) : step === 'edit' && editable ? (
        <div className="editing-workspace">
          <Notice>{task.error}</Notice>
          <Suspense
            fallback={
              <Empty icon={<LoaderCircle className="spin" size={32} />} title="Opening editor" />
            }
          >
            <PhotoEditor
              key={editable.id}
              ref={editor}
              photo={editable}
              event={event}
              onStatus={setStatus}
              onError={task.setError}
            />
          </Suspense>
        </div>
      ) : (
        <div className="review-workspace">
          <div className="workspace-toolbar">
            <div>
              <h1>Confirm Image</h1>
            </div>
          </div>
          <Notice>
            {task.error ||
              (chosen.some((photo) => photo.renderStatus === 'failed')
                ? 'An image could not be saved. Go back to photos to edit and save it again.'
                : chosen.some((photo) => photo.renderStatus === 'none')
                  ? 'Go back to photos and save your edits before confirming.'
                  : chosen.some((photo) => photo.renderStatus !== 'ready')
                    ? 'Saving final images…'
                    : '')}
          </Notice>
          <div className="review-grid">
            {chosen.map((photo) => (
              <figure
                key={photo.id}
                className="review-card"
                style={
                  {
                    '--photo-ratio':
                      (photo.finalWidth ?? photo.width) / (photo.finalHeight ?? photo.height),
                  } as React.CSSProperties
                }
              >
                <LoadedImage
                  src={photoUrl(photo.id, photo.renderStatus === 'ready' ? 'final' : 'preview')}
                  alt={`Final image ${photo.number}`}
                />
              </figure>
            ))}
          </div>
          {!chosen.length ? (
            <Empty icon={<Images size={40} />} title="Choose at least one final photo">
              <Button onClick={() => setStep('choose')}>Back to photos</Button>
            </Empty>
          ) : null}
        </div>
      )}
      <Modal
        opened={compareOpen}
        onClose={() => {
          setCompareOpen(false);
          setCompareMode(false);
          setCompareIds([]);
        }}
        title="Compare photos"
        size="min(1280px, calc(100vw - 48px))"
        centered
        className="compare-modal"
      >
        <div className="comparison-summary">
          <span>Scroll or pinch to zoom</span>
          <span>
            {chosen.length} of {event.selectionLimit} chosen
          </span>
        </div>
        <div className="compare-grid">
          {compareIds.map((id) => {
            const p = ticket?.photos.find((p) => p.id === id);
            return p ? (
              <section
                className={`compare-pane ${p.chosen ? 'is-chosen' : ''}`}
                aria-label={`Comparison image ${p.number}`}
                key={id}
              >
                <PhotoInspector photo={p} final={false} zebra={false} compact />
                <div className="compare-controls">
                  <span>{p.chosen ? 'Final choice' : 'Choose for editing'}</span>
                  <Button
                    className="compare-choice-button"
                    aria-label={`${p.chosen ? 'Unchoose' : 'Choose'} image ${p.number}`}
                    disabled={!claimed || p.excludedPhotography || p.excludedSelection}
                    blocked={task.busy}
                    primary={p.chosen}
                    onClick={() => void updatePhoto(p, { chosen: !p.chosen })}
                  >
                    <span className="label-size-reserve" aria-hidden="true">
                      Choose this photo
                    </span>
                    <span className="compare-choice-label">
                      {p.chosen ? <Check size={18} /> : null}
                      {p.chosen ? 'Chosen' : 'Choose this photo'}
                    </span>
                  </Button>
                </div>
              </section>
            ) : null;
          })}
        </div>
      </Modal>
    </StationLayout>
  );
}
