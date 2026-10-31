import { useCallback, useEffect, useRef, useState } from 'react';

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function useLocal<T>(key: string, initial: T) {
  const [entry, setEntry] = useState(() => ({ key, value: readLocal(key, initial) }));
  const value = entry.key === key ? entry.value : readLocal(key, initial);
  const set = useCallback(
    (next: T | ((current: T) => T)) =>
      setEntry((previous) => {
        const current = previous.key === key ? previous.value : readLocal(key, initial),
          value = typeof next === 'function' ? (next as (v: T) => T)(current) : next;
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {}
        return { key, value };
      }),
    [key, initial],
  );
  return [value, set] as const;
}
export function useTask() {
  const [busy, setBusy] = useState(false),
    [operation, setOperation] = useState<string>(),
    [error, setError] = useState(''),
    lock = useRef(false);
  const run = useCallback(
    async <T>(task: () => Promise<T>, operation?: string): Promise<T | undefined> => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setOperation(operation);
      setError('');
      try {
        return await task();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong. Please retry.');
        return undefined;
      } finally {
        lock.current = false;
        setBusy(false);
        setOperation(undefined);
      }
    },
    [],
  );
  return { busy, operation, error, setError, run };
}
export function usePolling<T>(load: () => Promise<T>, interval = 4000) {
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState('');
  const loader = useRef(load);
  loader.current = load;
  const refresh = useCallback(async () => {
    try {
      const result = await loader.current();
      setValue(result);
      setError('');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to connect.');
      return null;
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const result = await loader.current();
        if (mounted) {
          setValue(result);
          setError('');
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Unable to connect.');
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), interval);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [interval]);
  return { value, setValue, error, refresh };
}
export function usePageSize(large = false) {
  const [size, setSize] = useState(8);
  useEffect(() => {
    const update = () =>
      setSize(
        window.innerWidth < 700
          ? 4
          : large
            ? 4
            : window.innerWidth >= 1440 && window.innerHeight >= 900
              ? 12
              : 8,
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [large]);
  return size;
}
