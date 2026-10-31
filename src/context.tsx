import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  defaultPreferences,
  type Bootstrap,
  type EventConfig,
  type Preferences,
  type Station,
} from '../shared/types';
import { api } from './lib/api';
import { readLocal } from './lib/hooks';
import { startConnectionMonitor, subscribeConnection } from './lib/connection';
import { WifiOff, LoaderCircle } from 'lucide-react';

const AppContext = createContext<{
  bootstrap: Bootstrap | null;
  error: string;
  refresh: () => Promise<void>;
  connection: 'checking' | 'connected' | 'waiting' | 'offline';
}>({ bootstrap: null, error: '', refresh: async () => {}, connection: 'checking' });
export function AppProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [error, setError] = useState(''),
    [connection, setConnection] = useState<'checking' | 'connected' | 'waiting' | 'offline'>(
      'checking',
    );
  const refresh = useCallback(async () => {
    try {
      setBootstrap(await api<Bootstrap>('/bootstrap'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to connect.');
    }
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeConnection(setConnection);
    const stop = startConnectionMonitor();
    return () => {
      unsubscribe();
      stop();
    };
  }, []);
  useEffect(() => {
    void refresh();
    const renew = () => void refresh();
    window.addEventListener('framerelay:authorization', renew);
    window.addEventListener('framerelay:reconnected', renew);
    const timer = window.setInterval(renew, 10000);
    return () => {
      window.removeEventListener('framerelay:authorization', renew);
      window.removeEventListener('framerelay:reconnected', renew);
      window.clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (connection !== 'offline') return;
    const otherSurfaces = Array.from(document.body.children).filter(
      (element) => element.id !== 'root' && element instanceof HTMLElement,
    ) as HTMLElement[];
    const previous = otherSurfaces.map((element) => element.inert);
    otherSurfaces.forEach((element) => {
      element.inert = true;
    });
    document.querySelector<HTMLElement>('.connection-overlay')?.focus();
    return () =>
      otherSurfaces.forEach((element, index) => {
        element.inert = previous[index];
      });
  }, [connection]);
  return (
    <AppContext.Provider value={{ bootstrap, error, refresh, connection }}>
      <div
        inert={connection === 'offline' ? true : undefined}
        aria-hidden={connection === 'offline' ? true : undefined}
      >
        {children}
      </div>
      {connection === 'offline' ? (
        <div
          className="connection-overlay"
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="connection-title"
          aria-describedby="connection-description"
        >
          <div className="connection-overlay-content">
            <WifiOff size={42} aria-hidden="true" />
            <h1 id="connection-title">Connection lost</h1>
            <p id="connection-description">
              FrameRelay can't reach the server. Your current screen will return when the connection
              is restored.
            </p>
            <span className="connection-retrying">
              <LoaderCircle size={18} className="spin" /> Reconnecting…
            </span>
          </div>
        </div>
      ) : null}
    </AppContext.Provider>
  );
}
export const useApp = () => useContext(AppContext);
const StationContext = createContext<{
  station: Station;
  event: EventConfig;
  prefs: Preferences;
  updatePrefs: (patch: Partial<Preferences>) => void;
  resetPrefs: () => void;
} | null>(null);
function preferences(key: string): Preferences {
  const stored = readLocal<Partial<Preferences>>(key, {});
  return {
    footerOverride:
      typeof stored.footerOverride === 'string' ? stored.footerOverride.slice(0, 240) : null,
    qrSize: stored.qrSize === 'medium' ? 'medium' : 'large',
    cameraId: typeof stored.cameraId === 'string' ? stored.cameraId : '',
    thumbnailSize: stored.thumbnailSize === 'large' ? 'large' : 'comfortable',
    queueDensity: stored.queueDensity === 'compact' ? 'compact' : 'comfortable',
    showCompleted: stored.showCompleted === true,
    highlightZebras: stored.highlightZebras !== false,
  };
}
export function StationProvider({
  station,
  event,
  children,
}: {
  station: Station;
  event: EventConfig;
  children: ReactNode;
}) {
  const key = `framerelay.v1.${event.id}.${station}.preferences`,
    [prefs, setPrefs] = useState(() => preferences(key));
  useEffect(() => {
    setPrefs(preferences(key));
  }, [key]);
  const updatePrefs = useCallback(
    (patch: Partial<Preferences>) =>
      setPrefs((current) => {
        const next = { ...current, ...patch };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      }),
    [key],
  );
  return (
    <StationContext.Provider
      value={{
        station,
        event,
        prefs,
        updatePrefs,
        resetPrefs: () => {
          try {
            localStorage.removeItem(key);
          } catch {}
          setPrefs({ ...defaultPreferences });
        },
      }}
    >
      {children}
    </StationContext.Provider>
  );
}
export function useStation() {
  const value = useContext(StationContext);
  if (!value) throw new Error('Station context missing.');
  return value;
}
