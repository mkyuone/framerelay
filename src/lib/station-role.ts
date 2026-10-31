import { stations, type Station } from '../../shared/types';

const key = 'framerelay.station-role';

export function rememberedStation(): Station {
  try {
    const saved = localStorage.getItem(key);
    if (stations.includes(saved as Station)) return saved as Station;
  } catch {}
  return 'registration';
}

export function rememberStation(station: Station) {
  try {
    localStorage.setItem(key, station);
  } catch {}
}

// Older installations still launch at /registration until their manifest is refreshed.
export function restoreLegacyPwaLaunch() {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone && location.pathname === '/registration' && !location.search) {
    const station = rememberedStation();
    if (station !== 'registration') history.replaceState(history.state, '', `/${station}`);
  }
}
