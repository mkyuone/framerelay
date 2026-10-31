import type { Ticket } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
function stationId() {
  try {
    let id = localStorage.getItem('framerelay.device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('framerelay.device', id);
    }
    return id;
  } catch {
    return sessionDevice;
  }
}
const sessionDevice = crypto.randomUUID();
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      'X-Station-Id': stationId(),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = 'Connection failed. Please retry.';
    try {
      message = (await response.json()).message ?? message;
    } catch {}
    if (response.status === 401 || message.startsWith('Stations are not configured.'))
      window.dispatchEvent(new Event('framerelay:authorization'));
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const photoUrl = (
  id: string,
  size: 'thumbnail' | 'preview' | 'original' | 'final' = 'preview',
) => `/api/photos/${id}/image?size=${size}`;
export function upload(
  path: string,
  file: Blob,
  name: string,
  onProgress: (progress: number) => void,
  recipe?: unknown,
): Promise<Ticket> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(),
      form = new FormData();
    if (recipe !== undefined) form.append('recipe', JSON.stringify(recipe));
    form.append('file', file, name);
    request.open('POST', `/api${path}`);
    request.setRequestHeader('X-Station-Id', stationId());
    request.timeout = 180_000;
    request.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    request.onerror = () => reject(new Error('Upload interrupted. Keep this page open and retry.'));
    request.ontimeout = () => reject(new Error('Upload timed out. Retry this photo.'));
    request.onload = () => {
      let value;
      try {
        value = JSON.parse(request.responseText);
      } catch {
        reject(new Error('The server returned an invalid response. Retry.'));
        return;
      }
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(value);
      } else reject(new ApiError(value.message ?? 'Upload failed.', request.status));
    };
    request.send(form);
  });
}
