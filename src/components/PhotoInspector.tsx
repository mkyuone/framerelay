import { LoadedImage } from './LoadedImage';
import { useEffect, useId, useRef, useState } from 'react';
import { ScanLine, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Photo } from '../../shared/types';
import { photoUrl } from '../lib/api';
import { Button } from './Ui';
import { ExposureImage } from './ExposureImage';

type View = { zoom: number; x: number; y: number };
const fitView: View = { zoom: 1, x: 0, y: 0 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function PhotoInspector({
  photo,
  final,
  zebra,
  onZebra,
  onClose,
  compact = false,
}: {
  photo: Photo;
  final: boolean;
  zebra: boolean;
  onZebra?: () => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  const helpId = useId();
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState<View>(fitView);
  const [loadedSource, setLoadedSource] = useState('');
  const [originalError, setOriginalError] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const current = useRef({ view, size });
  current.current = { view, size };
  const width = final ? (photo.finalWidth ?? photo.width) : photo.width;
  const height = final ? (photo.finalHeight ?? photo.height) : photo.height;
  const fit = Math.min(1, size.width / width, size.height / height);
  const fitWidth = width * fit,
    fitHeight = height * fit;
  function bounded(next: View, area = current.current.size): View {
    const scale = Math.min(1, area.width / width, area.height / height);
    const zoom = clamp(next.zoom, 1, Math.max(1, 4 / scale));
    const limitX = Math.max(0, (width * scale * zoom - area.width) / 2);
    const limitY = Math.max(0, (height * scale * zoom - area.height) / 2);
    return { zoom, x: clamp(next.x, -limitX, limitX), y: clamp(next.y, -limitY, limitY) };
  }
  function update(next: View) {
    const boundedView = bounded(next);
    current.current.view = boundedView;
    setView(boundedView);
  }
  function zoomAt(factor: number, x = 0, y = 0) {
    const old = current.current.view;
    const zoom = bounded({ ...old, zoom: old.zoom * factor }).zoom;
    const ratio = zoom / old.zoom;
    update({ zoom, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio });
  }
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      current.current.size = next;
      setSize(next);
      update(current.current.view);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      zoomAt(
        Math.exp(-clamp(delta, -200, 200) * (event.ctrlKey ? 0.015 : 0.0025)),
        event.clientX - bounds.left - bounds.width / 2,
        event.clientY - bounds.top - bounds.height / 2,
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  }, [width, height]);
  const zoomed = view.zoom > 1.001;
  const imageWidth = fitWidth * view.zoom,
    imageHeight = fitHeight * view.zoom;
  const left = (size.width - imageWidth) / 2 + view.x,
    top = (size.height - imageHeight) / 2 + view.y;
  const region = {
    left: clamp(-left / imageWidth, 0, 1),
    top: clamp(-top / imageHeight, 0, 1),
    width: Math.min(size.width, imageWidth) / imageWidth,
    height: Math.min(size.height, imageHeight) / imageHeight,
  };
  function navigate(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    update({
      ...current.current.view,
      x: (0.5 - clamp((event.clientX - rect.left) / rect.width, 0, 1)) * imageWidth,
      y: (0.5 - clamp((event.clientY - rect.top) / rect.height, 0, 1)) * imageHeight,
    });
  }
  const fullSource = photoUrl(photo.id, final ? 'final' : 'original');
  const originalLoaded = loadedSource === fullSource;
  useEffect(() => {
    setLoadedSource('');
    setOriginalError(false);
  }, [fullSource, zoomed]);
  return (
    <>
      <div className="preview-toolbar inspector-toolbar">
        <span>Image {String(photo.number).padStart(2, '0')}</span>
        <div className="inspector-tools">
          {onZebra ? (
            <Button
              aria-label="Highlight zebras"
              aria-pressed={zebra}
              className={zebra ? 'selected-control' : ''}
              title="Highlight warning: JPEG brightness ≥98%. Originals unchanged."
              onClick={onZebra}
            >
              <ScanLine size={18} />
              <span className="zebra-label">Zebras</span>
            </Button>
          ) : null}
          <Button aria-label="Zoom out" disabled={!zoomed} onClick={() => zoomAt(1 / 1.4)}>
            <ZoomOut size={18} />
          </Button>
          <output
            className="zoom-readout"
            aria-label="Image zoom"
            title="Actual image pixels · Press 1 for 100%, 0 to fit"
          >
            {Math.round(fit * view.zoom * 100)}%
          </output>
          <Button
            aria-label="Zoom in"
            disabled={fit * view.zoom >= 3.999}
            onClick={() => zoomAt(1.4)}
          >
            <ZoomIn size={18} />
          </Button>
          <Button
            className="zoom-mode-button"
            onClick={() => (zoomed ? update(fitView) : zoomAt(Math.max(2, 1 / fit)))}
          >
            <span className="zoom-label-sizer" aria-hidden="true">
              {compact ? '100%' : 'Inspect detail'}
            </span>
            <span>
              {compact ? (zoomed ? 'Fit' : '100%') : zoomed ? 'Fit image' : 'Inspect detail'}
            </span>
          </Button>
          {onClose ? (
            <Button aria-label="Close preview" onClick={onClose}>
              <X size={20} />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="inspector-stage-wrap">
        <div
          ref={stage}
          className={`inspector-stage ${zoomed ? 'is-zoomed' : ''}`}
          tabIndex={0}
          role="region"
          aria-label={
            compact ? `Photo detail viewer — image ${photo.number}` : 'Photo detail viewer'
          }
          aria-describedby={helpId}
          onDoubleClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            if (zoomed) update(fitView);
            else
              zoomAt(
                Math.max(2, 1 / fit),
                event.clientX - box.left - box.width / 2,
                event.clientY - box.top - box.height / 2,
              );
          }}
          onKeyDown={(event) => {
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [60, 0],
              ArrowRight: [-60, 0],
              ArrowUp: [0, 60],
              ArrowDown: [0, -60],
            };
            if (moves[event.key]) {
              event.preventDefault();
              const [x, y] = moves[event.key];
              update({ ...view, x: view.x + x, y: view.y + y });
            } else if (['+', '=', '-', '0', '1'].includes(event.key)) {
              event.preventDefault();
              if (event.key === '0') update(fitView);
              else if (event.key === '1') zoomAt(1 / fit / view.zoom);
              else zoomAt(event.key === '-' ? 1 / 1.4 : 1.4);
            }
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          }}
          onPointerMove={(event) => {
            const previous = pointers.current.get(event.pointerId);
            if (!previous) return;
            const before = [...pointers.current.values()];
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            const after = [...pointers.current.values()];
            if (after.length === 2) {
              const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
              const distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
              const bounds = event.currentTarget.getBoundingClientRect();
              if (oldDistance > 0)
                zoomAt(
                  distance / oldDistance,
                  (before[0].x + before[1].x) / 2 - bounds.left - bounds.width / 2,
                  (before[0].y + before[1].y) / 2 - bounds.top - bounds.height / 2,
                );
              const now = current.current.view;
              update({
                ...now,
                x: now.x + (after[0].x + after[1].x - before[0].x - before[1].x) / 2,
                y: now.y + (after[0].y + after[1].y - before[0].y - before[1].y) / 2,
              });
            } else if (after.length === 1) {
              const now = current.current.view;
              update({
                ...now,
                x: now.x + event.clientX - previous.x,
                y: now.y + event.clientY - previous.y,
              });
            }
          }}
          onPointerUp={(event) => pointers.current.delete(event.pointerId)}
          onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
          onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
        >
          <div
            className="inspector-photo"
            data-zoom={view.zoom}
            data-pan-x={view.x}
            data-pan-y={view.y}
            style={{
              width: fitWidth,
              height: fitHeight,
              transform: `translate(${left}px, ${top}px) scale(${view.zoom})`,
            }}
          >
            <ExposureImage
              src={photoUrl(photo.id, final ? 'final' : 'preview')}
              alt={`Image ${photo.number}`}
              zebra={zebra}
            />
            {zoomed ? (
              <img
                className={`inspector-original ${originalLoaded ? 'loaded' : ''}`}
                src={fullSource}
                alt=""
                aria-hidden="true"
                draggable={false}
                onLoad={(event) => {
                  void event.currentTarget
                    .decode()
                    .then(() => setLoadedSource(fullSource))
                    .catch(() => setOriginalError(true));
                  setOriginalError(false);
                }}
                onError={() => setOriginalError(true)}
              />
            ) : null}
          </div>
        </div>
        {zoomed ? (
          <div
            className="photo-navigator"
            role="region"
            aria-label="Zoom navigator"
            style={{
              aspectRatio: `${width} / ${height}`,
              width: Math.min(160, (130 * width) / height),
              maxWidth: '25%',
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              navigate(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) navigate(event);
            }}
          >
            <LoadedImage
              src={photoUrl(photo.id, final ? 'final' : 'thumbnail')}
              alt=""
              draggable={false}
            />
            <div
              className="navigator-viewport"
              style={{
                left: `${region.left * 100}%`,
                top: `${region.top * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            />
          </div>
        ) : null}
        {zoomed && (!originalLoaded || originalError) ? (
          <span className="inspector-loading" role="status">
            {originalError
              ? 'Full resolution unavailable · showing preview'
              : 'Loading full resolution…'}
          </span>
        ) : null}
      </div>
      <div className={compact ? 'sr-only' : 'inspector-help'} id={helpId}>
        Scroll or pinch to zoom
      </div>
    </>
  );
}
