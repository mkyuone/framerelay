type ConnectionState = 'checking' | 'connected' | 'waiting' | 'offline';
let state: ConnectionState = 'checking';
let failedAt: number | null = null;
const listeners = new Set<(state: ConnectionState) => void>();

function publish(next: ConnectionState) {
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener(next));
  if (next === 'connected') window.dispatchEvent(new Event('framerelay:reconnected'));
}
function failed() {
  failedAt ??= Date.now();
  publish(Date.now() - failedAt >= 5000 ? 'offline' : 'waiting');
}
export function reportConnectionFailure() {
  failed();
}
export function subscribeConnection(listener: (state: ConnectionState) => void) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}
export function startConnectionMonitor() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const offline = () => failed();
  const check = async () => {
    if (stopped) return;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 1500);
    try {
      const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Server unavailable');
      failedAt = null;
      publish('connected');
    } catch {
      if (!stopped) failed();
    } finally {
      clearTimeout(timeout);
      if (!stopped) timer = setTimeout(check, 1000);
    }
  };
  window.addEventListener('offline', offline);
  void check();
  return () => {
    stopped = true;
    controller?.abort();
    clearTimeout(timer);
    window.removeEventListener('offline', offline);
  };
}
export function waitForConnection(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    if (state === 'connected') {
      resolve();
      return;
    }
    const cleanup = () => {
      listeners.delete(onChange);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason);
    };
    const onChange = (next: ConnectionState) => {
      if (next === 'connected') {
        cleanup();
        resolve();
      }
    };
    listeners.add(onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
