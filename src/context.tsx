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

const AppContext = createContext<{
  bootstrap: Bootstrap | null;
  error: string;
  refresh: () => Promise<void>;
}>({ bootstrap: null, error: '', refresh: async () => {} });
export function AppProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setBootstrap(await api<Bootstrap>('/bootstrap'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to connect.');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const renew = () => void refresh();
    window.addEventListener('framerelay:authorization', renew);
    const timer = window.setInterval(renew, 10000);
    return () => {
      window.removeEventListener('framerelay:authorization', renew);
      window.clearInterval(timer);
    };
  }, [refresh]);
  return (
    <AppContext.Provider value={{ bootstrap, error, refresh }}>{children}</AppContext.Provider>
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
