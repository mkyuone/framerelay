import { useEffect, useRef, useState } from 'react';
import { Modal } from '@mantine/core';
import {
  Check,
  Circle,
  Columns2,
  Eye,
  EyeOff,
  ImageOff,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { Photo } from '../../shared/types';
import { photoUrl } from '../lib/api';
import { Button, Pagination } from './Ui';
import type { UploadItem } from '../lib/uploads';
import { ExposureImage } from './ExposureImage';
import { PhotoInspector } from './PhotoInspector';

function UploadCard({
  item,
  onRetry,
  onDiscard,
}: {
  item: UploadItem;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
}) {
  const [source, setSource] = useState(''),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const url = URL.createObjectURL(item.file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file]);
  const status =
    item.state === 'failed'
      ? 'Upload failed'
      : item.state === 'queued'
        ? 'Queued'
        : item.progress >= 99
          ? 'Processing…'
          : `Uploading ${item.progress}%`;
  return (
    <article
      className={`photo-card upload-card ${item.state === 'failed' ? 'failed' : ''}`}
      aria-label={`Upload ${item.file.name}`}
    >
      <div className="photo-preview upload-preview">
        {source && !invalid ? (
          <img src={source} alt={`Uploading ${item.file.name}`} onError={() => setInvalid(true)} />
        ) : (
          <ImageOff size={28} aria-label="Preview unavailable" />
        )}
      </div>
      <div className="photo-card-meta">
        <div className="upload-caption">
          <span className="upload-filename" title={item.file.name}>
            {item.file.name}
          </span>
          <span
            className={`photo-state ${item.state === 'failed' ? 'error-text' : ''}`}
            role="status"
            title={item.error}
          >
            {status}
          </span>
          {item.state === 'failed' && item.error ? (
            <span className="upload-error" role="alert">
              {item.error}
            </span>
          ) : null}
        </div>
        {item.state === 'failed' ? (
          <div className="photo-card-actions">
            <Button onClick={() => onRetry?.(item.id)}>Retry</Button>
            <button
              className="icon-button"
              aria-label={`Remove failed upload ${item.file.name}`}
              onClick={() => onDiscard?.(item.id)}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function PhotoGrid({
  photos,
  page = 0,
  pageSize,
  onPage,
  mode,
  onChoose,
  onExclude,
  disabled = false,
  pending = false,
  compareIds = [],
  onCompareToggle,
  final = false,
  uploads = [],
  onRetryUpload,
  onDiscardUpload,
  zebra = false,
  onZebra,
}: {
  photos: Photo[];
  page?: number;
  pageSize: number;
  onPage?: (value: number) => void;
  mode: 'photography' | 'selection' | 'review';
  onChoose?: (photo: Photo) => void;
  onExclude?: (photo: Photo) => void;
  disabled?: boolean;
  pending?: boolean;
  compareIds?: string[];
  onCompareToggle?: (photo: Photo) => void;
  final?: boolean;
  uploads?: UploadItem[];
  onRetryUpload?: (id: string) => void;
  onDiscardUpload?: (id: string) => void;
  zebra?: boolean;
  onZebra?: () => void;
}) {
  const paginated = mode === 'review';
  const grid = useRef<HTMLDivElement>(null),
    [capacity, setCapacity] = useState(pageSize);
  useEffect(() => {
    if (!paginated) return;
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element),
        columns = style.gridTemplateColumns.split(' ').length,
        gap = parseFloat(style.rowGap) || 0,
        width = (element.clientWidth - (columns - 1) * gap) / columns,
        cardHeight = (width * 2) / 3 + 58,
        rows = Math.max(1, Math.floor((element.clientHeight + gap) / (cardHeight + gap)));
      setCapacity(Math.min(pageSize, rows * columns));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pageSize, paginated]);
  const [preview, setPreview] = useState<string | null>(null);
  const current = photos.find((p) => p.id === preview),
    index = photos.findIndex((p) => p.id === preview),
    effectivePageSize = Math.max(1, Math.min(pageSize, capacity)),
    entries = [
      ...photos.map((photo) => ({ kind: 'photo' as const, photo })),
      ...uploads.map((item) => ({ kind: 'upload' as const, item })),
    ],
    pages = Math.ceil(entries.length / effectivePageSize),
    safePage = Math.min(page, Math.max(0, pages - 1)),
    visibleEntries = paginated
      ? entries.slice(safePage * effectivePageSize, (safePage + 1) * effectivePageSize)
      : entries;
  function next(delta: number) {
    setPreview(photos[(index + delta + photos.length) % photos.length].id);
  }
  return (
    <>
      <div
        ref={grid}
        className={`photo-grid count-${pageSize}${paginated ? '' : ' scrolling-grid'}`}
      >
        {visibleEntries.map((entry) => {
          if (entry.kind === 'upload')
            return (
              <UploadCard
                key={entry.item.id}
                item={entry.item}
                onRetry={onRetryUpload}
                onDiscard={onDiscardUpload}
              />
            );
          const photo = entry.photo;
          const excluded =
            mode === 'photography'
              ? photo.excludedPhotography
              : photo.excludedPhotography || photo.excludedSelection;
          const canSelectBar =
            !disabled &&
            !pending &&
            (onCompareToggle
              ? compareIds.includes(photo.id) || compareIds.length < 2
              : !!onChoose && !excluded);
          return (
            <article
              className={`photo-card ${photo.chosen && mode !== 'photography' ? 'chosen' : ''} ${compareIds.includes(photo.id) ? 'compare-picked' : ''} ${excluded ? 'excluded' : ''} ${excluded && mode === 'selection' ? 'selection-excluded' : ''}`}
              aria-label={
                excluded && mode === 'selection'
                  ? `Image ${photo.number}, excluded from selection`
                  : undefined
              }
              key={photo.id}
            >
              <button
                className="photo-preview"
                onClick={() => {
                  if (onCompareToggle) {
                    if (
                      !disabled &&
                      !pending &&
                      (compareIds.includes(photo.id) || compareIds.length < 2)
                    )
                      onCompareToggle(photo);
                  } else setPreview(photo.id);
                }}
                aria-label={
                  onCompareToggle
                    ? `${compareIds.includes(photo.id) ? 'Remove' : 'Add'} image ${photo.number} ${compareIds.includes(photo.id) ? 'from' : 'to'} comparison`
                    : `Preview image ${photo.number}`
                }
                aria-pressed={onCompareToggle ? compareIds.includes(photo.id) : undefined}
              >
                <ExposureImage
                  src={photoUrl(photo.id, final ? 'final' : 'thumbnail')}
                  alt={`Image ${String(photo.number).padStart(2, '0')}`}
                  loading="lazy"
                  zebra={zebra}
                />
                {compareIds.includes(photo.id) ? (
                  <span className="compare-pick-badge" aria-hidden="true">
                    {compareIds.indexOf(photo.id) + 1}
                  </span>
                ) : null}
                {excluded && mode === 'selection' ? (
                  <svg
                    className="excluded-strike"
                    viewBox="0 0 300 200"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <line
                      x1="0"
                      y1="200"
                      x2="300"
                      y2="0"
                      stroke="currentColor"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                ) : excluded ? (
                  <span className="image-overlay">
                    <EyeOff size={18} />
                    Excluded
                  </span>
                ) : null}
              </button>
              <div
                className={`photo-card-meta ${canSelectBar ? 'selectable-bar' : ''}`}
                onClick={(event) => {
                  if (
                    !canSelectBar ||
                    (event.target instanceof Element &&
                      event.target.closest('button, a, input, select, textarea'))
                  )
                    return;
                  if (onCompareToggle) onCompareToggle(photo);
                  else onChoose?.(photo);
                }}
              >
                <span className="image-number">{String(photo.number).padStart(2, '0')}</span>
                {mode === 'photography' ? (
                  <span className="photo-state">Ready</span>
                ) : photo.renderStatus === 'processing' || photo.renderStatus === 'pending' ? (
                  <span className="photo-state">Saving…</span>
                ) : photo.renderStatus === 'failed' ? (
                  <span className="photo-state error-text">Save failed</span>
                ) : photo.renderStatus === 'ready' ? (
                  <span className="photo-state">Edited</span>
                ) : null}
                <div className="photo-card-actions">
                  {onCompareToggle ? (
                    <button
                      className={`icon-button ${compareIds.includes(photo.id) ? 'selected-control' : ''}`}
                      aria-label={`Compare image ${photo.number}`}
                      title={
                        compareIds.includes(photo.id)
                          ? 'Remove from comparison'
                          : 'Add to comparison'
                      }
                      aria-pressed={compareIds.includes(photo.id)}
                      disabled={
                        disabled ||
                        pending ||
                        (!compareIds.includes(photo.id) && compareIds.length >= 2)
                      }
                      data-blocked={
                        (pending &&
                          !disabled &&
                          (compareIds.includes(photo.id) || compareIds.length < 2)) ||
                        undefined
                      }
                      onClick={() => onCompareToggle(photo)}
                    >
                      <Columns2 size={18} />
                    </button>
                  ) : null}
                  {onChoose ? (
                    <button
                      className="icon-button choose-control"
                      disabled={disabled || pending || excluded}
                      data-blocked={(pending && !disabled && !excluded) || undefined}
                      aria-label={`${photo.chosen ? 'Unchoose' : 'Choose'} image ${photo.number}`}
                      aria-pressed={photo.chosen}
                      onClick={() => onChoose(photo)}
                    >
                      {photo.chosen ? <Check size={21} /> : <Circle size={21} />}
                    </button>
                  ) : null}
                  {onExclude ? (
                    <button
                      className="icon-button exclude-control"
                      disabled={disabled || pending}
                      data-blocked={(pending && !disabled) || undefined}
                      title={excluded ? 'Restore image' : 'Exclude image'}
                      aria-label={`${excluded ? 'Restore' : 'Exclude'} image ${photo.number}`}
                      onClick={() => onExclude(photo)}
                    >
                      {excluded ? <Eye size={18} /> : <EyeOff size={17} />}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {paginated ? (
        <Pagination
          page={safePage}
          pages={pages}
          onChange={(value) => onPage?.(value)}
          count={entries.length}
        />
      ) : null}
      <Modal
        opened={!!current}
        onClose={() => setPreview(null)}
        withCloseButton={false}
        className="preview-modal"
        size="min(1000px, calc(100vw - 48px))"
        centered
      >
        {current ? (
          <>
            <PhotoInspector
              key={current.id}
              photo={current}
              final={final}
              zebra={zebra}
              onZebra={onZebra}
              onClose={() => setPreview(null)}
            />
            <div className="preview-controls">
              <Button
                aria-label="Previous image"
                disabled={photos.length < 2}
                onClick={() => next(-1)}
              >
                <ChevronLeft size={20} />
              </Button>
              <div>
                {onExclude ? (
                  <Button disabled={disabled} blocked={pending} onClick={() => onExclude(current)}>
                    {current.excludedPhotography || current.excludedSelection
                      ? 'Restore image'
                      : 'Exclude image'}
                  </Button>
                ) : null}
                {onChoose ? (
                  <Button
                    primary={current.chosen}
                    disabled={disabled || current.excludedPhotography || current.excludedSelection}
                    blocked={pending}
                    onClick={() => onChoose(current)}
                  >
                    {current.chosen ? 'Chosen' : 'Choose image'}
                  </Button>
                ) : null}
              </div>
              <Button aria-label="Next image" disabled={photos.length < 2} onClick={() => next(1)}>
                <ChevronRight size={20} />
              </Button>
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
