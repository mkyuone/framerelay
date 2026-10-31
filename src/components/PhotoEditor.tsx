import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ImageEditor,
  type EditState,
  type ImageEditorHandle,
  type ToolInput,
  createEditState,
  parseEditState,
} from '@image-ultra/react';
import type { EventConfig, Photo, Ticket } from '../../shared/types';
import { patch, photoUrl, post, upload } from '../lib/api';
import { readLocal } from '../lib/hooks';
import { constrainCrop } from '../../shared/crop';
import { ImageOff, LoaderCircle } from 'lucide-react';
import { reportConnectionFailure } from '../lib/connection';

const tools: readonly ToolInput[] = ['adjust', 'finetune', 'filter', 'sticker'];

export interface PhotoEditorHandle {
  save: () => Promise<Ticket>;
  flush: () => Promise<void>;
}
export default forwardRef<
  PhotoEditorHandle,
  {
    photo: Photo;
    event: EventConfig;
    onStatus: (status: string) => void;
    onError: (message: string) => void;
  }
>(function PhotoEditor({ photo, event, onStatus, onError }, ref) {
  const editor = useRef<ImageEditorHandle>(null),
    host = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    pending = useRef<Promise<unknown>>(Promise.resolve()),
    latest = useRef<EditState | null>(null),
    changed = useRef(false);
  const draftKey = `framerelay.edit.${event.id}.${photo.id}`;
  const [asset, setAsset] = useState<{ source: string; url: string } | null>(null);
  const [assetError, setAssetError] = useState(false);
  const original = photoUrl(photo.id, 'original');
  useEffect(() => {
    let disposed = false;
    let url = '';
    let controller: AbortController | undefined;
    async function load() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      setAssetError(false);
      try {
        const response = await fetch(original, { signal: current.signal });
        if (!response.ok) throw new Error('Unable to load the photo.');
        const blob = await response.blob();
        const next = URL.createObjectURL(blob);
        const image = new Image();
        image.src = next;
        try {
          await image.decode();
        } catch (error) {
          URL.revokeObjectURL(next);
          throw error;
        }
        if (disposed || current.signal.aborted) {
          URL.revokeObjectURL(next);
          return;
        }
        if (url) URL.revokeObjectURL(url);
        url = next;
        setAsset({ source: original, url });
      } catch (error) {
        if (!disposed && !current.signal.aborted) {
          if (error instanceof TypeError) reportConnectionFailure();
          else setAssetError(true);
        }
      }
    }
    void load();
    const retry = () => {
      if (!url) void load();
    };
    window.addEventListener('framerelay:reconnected', retry);
    return () => {
      disposed = true;
      controller?.abort();
      if (url) URL.revokeObjectURL(url);
      window.removeEventListener('framerelay:reconnected', retry);
    };
  }, [original]);
  useLayoutEffect(() => {
    const root = host.current;
    if (!root) return;
    // The native preset component exposes text labels, but no ratio-filter prop.
    // Label its options so CSS and keyboard navigation share the allowed choices.
    const labelRatios = () => {
      for (const choice of root.querySelectorAll(
        '[role="radiogroup"][aria-label="Aspect ratio"] [role="radio"]',
      )) {
        const label = choice.querySelector('.iu-chip__label')?.textContent?.trim();
        if (label && choice.getAttribute('aria-label') !== label)
          choice.setAttribute('aria-label', label);
      }
    };
    labelRatios();
    const observer = new MutationObserver(labelRatios);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const initial = useMemo(() => {
    const draft = readLocal<EditState | null>(draftKey, null);
    let state = createEditState();
    try {
      if (draft || photo.recipe) state = parseEditState(draft || photo.recipe);
    } catch {}
    return constrainCrop(state, photo.width, photo.height);
  }, [photo.id, event.id]);
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    await pending.current.catch(() => {});
    if (changed.current && latest.current) {
      const state = latest.current;
      await patch(`/photos/${photo.id}`, { recipe: state });
      changed.current = false;
    }
  }
  useImperativeHandle(ref, () => ({
    flush,
    save: async () => {
      if (!editor.current) throw new Error('The editor is still loading.');
      if (editor.current.store.getState().status !== 'ready')
        throw new Error('Wait for the photo to finish loading, then save again.');
      await flush();
      const state = editor.current.getState();
      onStatus('Rendering full-resolution JPEG');
      let result;
      try {
        result = await editor.current.exportImage({
          mimeType: 'image/jpeg',
          quality: 0.96,
          keepMetadata: false,
        });
      } catch {
        onStatus('Queued for server export');
        return post<Ticket>(`/photos/${photo.id}/render`, { recipe: state });
      }
      if (result.downscaled) {
        onStatus('Queued for full-resolution server export');
        return post<Ticket>(`/photos/${photo.id}/render`, { recipe: state });
      }
      const ticket = await upload(
        `/photos/${photo.id}/final`,
        result.blob,
        result.fileName,
        (progress) => onStatus(progress === 99 ? 'Checking saved image' : `Saving ${progress}%`),
        state,
      );
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      changed.current = false;
      onStatus('Saved');
      return ticket;
    },
  }));
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (changed.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return (
    <div
      ref={host}
      className="photo-editor"
      onKeyDownCapture={(event) => {
        const group =
          event.target instanceof Element
            ? event.target.closest('[role="radiogroup"][aria-label="Aspect ratio"]')
            : null;
        if (
          !group ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const choices = [
          ...group.querySelectorAll<HTMLButtonElement>(
            '[role="radio"][aria-label="2:3"], [role="radio"][aria-label="3:2"]',
          ),
        ];
        const index = choices.findIndex((choice) => choice.getAttribute('aria-checked') === 'true');
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? choices.length - 1
              : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + choices.length) %
                choices.length;
        choices[next]?.click();
        choices[next]?.focus();
      }}
    >
      {asset?.source === original ? (
        <ImageEditor
          ref={editor}
          src={asset.url}
          initialState={initial}
          tools={tools}
          theme="dark"
          stickerLibrary={false}
          persistLooks={false}
          themeOverrides={{ accent: event.accentColor, accentText: '#a9d1ff' }}
          onError={(error) => onError(error.message)}
          onChange={(state) => {
            const constrained = constrainCrop(state, photo.width, photo.height);
            if (constrained !== state) {
              editor.current?.store.setState({ edit: constrained });
              return;
            }
            latest.current = state;
            changed.current = true;
            try {
              localStorage.setItem(draftKey, JSON.stringify(state));
            } catch {}
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              const value = latest.current;
              pending.current = pending.current
                .catch(() => {})
                .then(() => patch(`/photos/${photo.id}`, { recipe: value }))
                .then(() => {
                  if (latest.current === value) changed.current = false;
                })
                .catch((error) => {
                  onError(`Edits are saved in this browser. Server save failed: ${error.message}`);
                  throw error;
                });
              void pending.current.catch(() => {});
            }, 650);
          }}
        />
      ) : (
        <div className="editor-asset-status" role="status">
          {assetError ? (
            <>
              <ImageOff size={28} /> Unable to load the photo.
            </>
          ) : (
            <>
              <LoaderCircle size={28} className="spin" /> Loading photo…
            </>
          )}
        </div>
      )}
    </div>
  );
});
