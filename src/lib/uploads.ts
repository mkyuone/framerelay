import { useEffect, useRef, useState } from 'react';
import { get, set, del, keys } from 'idb-keyval';
import { upload } from './api';
import type { Ticket } from '../../shared/types';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  state: 'queued' | 'uploading' | 'failed';
  error?: string;
}
export function useUploads(
  eventId: string,
  ticketId: string | undefined,
  onTicket: (ticket: Ticket) => void,
) {
  const [items, setItems] = useState<UploadItem[]>([]),
    list = useRef<UploadItem[]>([]),
    running = useRef(0),
    callback = useRef(onTicket),
    active = useRef(true),
    scope = useRef(ticketId);
  callback.current = onTicket;
  scope.current = ticketId;
  const change = (next: UploadItem[]) => {
    list.current = next;
    if (active.current) setItems([...next]);
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const prefix = `framerelay.upload.${eventId}.${ticketId}.`;
  useEffect(() => {
    let mounted = true;
    change([]);
    if (ticketId)
      void keys()
        .then(async (names) => {
          const saved = await Promise.all(
            names
              .filter((key) => typeof key === 'string' && key.startsWith(prefix))
              .map((key) => get<UploadItem>(key)),
          );
          if (mounted)
            change(
              saved
                .filter((item): item is UploadItem => !!item)
                .map((item) => ({
                  ...item,
                  state: 'failed',
                  progress: 0,
                  error: 'Upload interrupted. Retry this photo.',
                })),
            );
        })
        .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [prefix, ticketId]);
  function pump(targetId: string) {
    while (running.current < 2) {
      const item = list.current.find((item) => item.state === 'queued');
      if (!item) break;
      item.state = 'uploading';
      running.current++;
      change([...list.current]);
      void upload(`/tickets/${targetId}/photos`, item.file, item.file.name, (progress) => {
        item.progress = progress;
        change([...list.current]);
      })
        .then(async (ticket) => {
          await del(`${prefix}${item.id}`).catch(() => {});
          if (scope.current === targetId) {
            change(list.current.filter((i) => i.id !== item.id));
            callback.current(ticket);
          }
        })
        .catch((error) => {
          item.state = 'failed';
          item.error = error.message;
          change([...list.current]);
        })
        .finally(() => {
          running.current--;
          if (scope.current === targetId) pump(targetId);
        });
    }
  }
  async function add(files: File[]) {
    if (!ticketId) return;
    const additions = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      state: 'queued' as const,
    }));
    for (const item of additions) await set(`${prefix}${item.id}`, item).catch(() => {});
    change([...list.current, ...additions]);
    pump(ticketId);
  }
  function retry(id: string) {
    const item = list.current.find((item) => item.id === id);
    if (!item || !ticketId) return;
    item.state = 'queued';
    item.progress = 0;
    item.error = undefined;
    change([...list.current]);
    pump(ticketId);
  }
  async function discard(id: string) {
    const item = list.current.find((item) => item.id === id);
    if (item?.state !== 'failed') return;
    await del(`${prefix}${id}`).catch(() => {});
    change(list.current.filter((item) => item.id !== id));
  }
  async function waitUntilIdle() {
    const end = Date.now() + 180_000;
    while (list.current.length) {
      if (list.current.some((item) => item.state === 'failed'))
        throw new Error('Retry or remove the failed uploads before finishing.');
      if (Date.now() > end)
        throw new Error('Uploads are taking longer than expected. Check the connection and retry.');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return {
    items,
    add,
    retry,
    discard,
    waitUntilIdle,
    busy: items.some((item) => item.state !== 'failed'),
  };
}
