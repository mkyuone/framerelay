import { useEffect, useRef, useState } from 'react';
import { get, set } from 'idb-keyval';
import type { Ticket } from '../../shared/types';

type Directory = FileSystemDirectoryHandle & {
  queryPermission: (options: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission: (options: { mode: 'read' }) => Promise<PermissionState>;
};
type Entry = { name: string; signature: string; file: File };
async function entries(folder: Directory): Promise<Entry[]> {
  const result: Entry[] = [];
  for await (const handle of (
    folder as unknown as { values: () => AsyncIterable<FileSystemHandle> }
  ).values()) {
    if (handle.kind === 'file' && /\.jpe?g$/i.test(handle.name)) {
      const file = await (handle as FileSystemFileHandle).getFile();
      result.push({ name: handle.name, signature: `${file.size}:${file.lastModified}`, file });
    }
  }
  return result;
}
export function useWatcher(
  eventId: string,
  ticket: Ticket | null,
  add: (files: File[]) => Promise<void>,
) {
  const [folder, setFolder] = useState<Directory | null>(null),
    [permitted, setPermitted] = useState(false),
    [error, setError] = useState(''),
    [paused, setPaused] = useState(false);
  const latest = useRef({ ticket, add });
  latest.current = { ticket, add };
  const seen = useRef<Record<string, string>>({}),
    stable = useRef(new Map<string, string>()),
    checking = useRef(false),
    ready = useRef(false),
    stopped = useRef(false);
  const folderKey = `framerelay.folder.${eventId}`,
    baselineKey = ticket ? `framerelay.baseline.${eventId}.${ticket.id}` : '';
  const supported = 'showDirectoryPicker' in window;
  useEffect(() => {
    let active = true;
    void get<Directory>(folderKey)
      .then(async (handle) => {
        if (handle && active) {
          setFolder(handle);
          setPermitted((await handle.queryPermission({ mode: 'read' })) === 'granted');
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [folderKey]);
  async function connect() {
    setError('');
    try {
      if (!supported)
        throw new Error(
          'Automatic folder ingestion requires Chrome. Drag-and-drop remains available.',
        );
      let handle = folder;
      if (!handle || (await handle.requestPermission({ mode: 'read' })) !== 'granted') {
        handle = await (
          window as unknown as { showDirectoryPicker: (o: { mode: 'read' }) => Promise<Directory> }
        ).showDirectoryPicker({ mode: 'read' });
      }
      await set(folderKey, handle);
      setFolder(handle);
      setPermitted(true);
      ready.current = false;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : 'Folder permission failed.');
    }
  }
  async function replace() {
    setFolder(null);
    const handle = await (
      window as unknown as { showDirectoryPicker: (o: { mode: 'read' }) => Promise<Directory> }
    ).showDirectoryPicker({ mode: 'read' });
    await set(folderKey, handle);
    setFolder(handle);
    setPermitted(true);
    ready.current = false;
  }
  useEffect(() => {
    ready.current = false;
    stable.current.clear();
    stopped.current = false;
    setPaused(false);
    if (!folder || !permitted || ticket?.status !== 'photographing') return;
    let alive = true;
    void (async () => {
      const previous = await get<Record<string, string>>(baselineKey);
      const current =
        previous ??
        Object.fromEntries((await entries(folder)).map((entry) => [entry.name, entry.signature]));
      if (alive) {
        seen.current = current;
        await set(baselineKey, current);
        ready.current = true;
      }
    })().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (alive && !stopped.current) void scan().catch(() => {});
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [folder, permitted, ticket?.id, ticket?.status, baselineKey]);
  async function scan() {
    if (!folder || !ready.current || checking.current) return;
    checking.current = true;
    try {
      const files = await entries(folder),
        additions: File[] = [];
      for (const entry of files) {
        if (seen.current[entry.name] === entry.signature) continue;
        if (stable.current.get(entry.name) === entry.signature && entry.file.size > 0) {
          additions.push(entry.file);
          seen.current[entry.name] = entry.signature;
          stable.current.delete(entry.name);
        } else stable.current.set(entry.name, entry.signature);
      }
      if (additions.length) {
        await latest.current.add(additions);
        await set(baselineKey, { ...seen.current });
      }
      setError('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Folder unavailable. Reconnect it in station settings.',
      );
      throw e;
    } finally {
      checking.current = false;
    }
  }
  async function finalScan() {
    if (!folder || !permitted) return;
    stopped.current = true;
    setPaused(true);
    if (!ready.current)
      throw new Error('Folder monitoring is still starting. Wait a moment and retry.');
    while (checking.current) await new Promise((resolve) => setTimeout(resolve, 100));
    await scan();
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await scan();
    if (stable.current.size) {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      await scan();
      if (stable.current.size)
        throw new Error('Some files are still changing. Finish exporting, then retry.');
    }
  }
  function resume() {
    stopped.current = false;
    setPaused(false);
  }
  return {
    folderName: folder?.name,
    connected: !!folder && permitted,
    supported,
    error,
    connect,
    replace,
    finalScan,
    resume,
    paused,
  };
}
