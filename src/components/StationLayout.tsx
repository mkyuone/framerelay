import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@mantine/core';
import {
  QrCode,
  Camera,
  SlidersHorizontal,
  Printer,
  Settings,
  Wifi,
  WifiOff,
  ArrowLeft,
  LogOut,
} from 'lucide-react';
import { stationNames, stations, type Station, type Ticket } from '../../shared/types';
import { useApp, useStation } from '../context';
import { api, post } from '../lib/api';
import { Button } from './Ui';

const stationIcons = {
  registration: QrCode,
  photography: Camera,
  selection: SlidersHorizontal,
  printing: Printer,
};

export interface HeaderAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  blocked?: boolean;
}
function StationTitle({ station }: { station: Station }) {
  const container = useRef<HTMLSpanElement>(null),
    fullLabel = useRef<HTMLSpanElement>(null),
    [compact, setCompact] = useState(false);
  const name = stationNames[station];
  useLayoutEffect(() => {
    const available = container.current,
      label = fullLabel.current;
    if (!available || !label) return;
    const measure = () =>
      setCompact(label.getBoundingClientRect().width > available.clientWidth + 0.5);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(available);
    observer.observe(label);
    return () => observer.disconnect();
  }, [name]);
  return (
    <span className="station-title" ref={container} title={name}>
      <span className="station-title-text">{compact ? name.replace(/ Station$/, '') : name}</span>
      <span className="station-title-measure" aria-hidden="true" ref={fullLabel}>
        {name}
      </span>
    </span>
  );
}
function Footer({ status, onSettings }: { status?: string; onSettings: () => void }) {
  const { event, prefs } = useStation();
  const [now, setNow] = useState(() => new Date()),
    [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      api('/health', { signal: AbortSignal.timeout(4000) })
        .then(() => {
          if (alive) setConnected(true);
        })
        .catch(() => {
          if (alive) setConnected(false);
        });
    void check();
    const network = setInterval(() => void check(), 5000),
      clock = setInterval(() => setNow(new Date()), 1000);
    return () => {
      alive = false;
      clearInterval(network);
      clearInterval(clock);
    };
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const footer = prefs.footerOverride ?? event.footerText;
  return (
    <footer className="station-footer">
      <span className="footer-copy" title={footer}>
        {footer}
      </span>
      <div className="footer-tools">
        <time dateTime={now.toISOString()} title={Intl.DateTimeFormat().resolvedOptions().timeZone}>
          {timestamp}
        </time>
        <span
          className={`connection ${connected === false ? 'offline' : ''}`}
          title={
            connected === null
              ? 'Connecting to server'
              : connected
                ? 'Server reachable'
                : 'Server unreachable'
          }
        >
          {connected === false ? <WifiOff size={15} /> : <Wifi size={15} />}
          <span>{connected === null ? 'Connecting' : connected ? 'Connected' : 'Offline'}</span>
        </span>
        {status ? (
          <span className="footer-status" title={status}>
            {status}
          </span>
        ) : null}
        <button
          className="icon-button settings-button"
          aria-label="Station settings"
          onClick={onSettings}
        >
          <Settings size={17} />
        </button>
      </div>
    </footer>
  );
}
function LocalSettings({ extra, onNavigate }: { extra?: ReactNode; onNavigate: () => void }) {
  const { station, prefs, updatePrefs, resetPrefs } = useStation();
  const { refresh } = useApp();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => setCameras(devices.filter((d) => d.kind === 'videoinput')))
      .catch(() => {});
  }, []);
  return (
    <div className="settings-form">
      <nav className="station-roles" aria-label="Station role">
        <span className="settings-label">Station role</span>
        <div>
          {stations.map((role) => (
            <Link
              key={role}
              to={`/${role}`}
              onClick={onNavigate}
              aria-current={role === station ? 'page' : undefined}
            >
              {stationNames[role]}
            </Link>
          ))}
        </div>
      </nav>
      <label>
        Footer text override
        <input
          value={prefs.footerOverride ?? ''}
          placeholder="Use the default footer"
          maxLength={240}
          onChange={(e) => updatePrefs({ footerOverride: e.target.value || null })}
        />
      </label>
      <p className="field-hint">Saved only in this browser for this station.</p>
      {station === 'registration' ? (
        <label>
          QR display size
          <select
            value={prefs.qrSize}
            onChange={(e) => updatePrefs({ qrSize: e.target.value as 'large' | 'medium' })}
          >
            <option value="large">Large</option>
            <option value="medium">Medium</option>
          </select>
        </label>
      ) : null}
      {station === 'photography' || station === 'selection' ? (
        <>
          <label>
            Scanning camera
            <select
              value={prefs.cameraId}
              onChange={(e) => updatePrefs({ cameraId: e.target.value })}
            >
              <option value="">Default camera</option>
              {cameras.map((camera, i) => (
                <option key={camera.deviceId || i} value={camera.deviceId}>
                  {camera.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Photo thumbnails
            <select
              value={prefs.thumbnailSize}
              onChange={(e) =>
                updatePrefs({ thumbnailSize: e.target.value as 'comfortable' | 'large' })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="large">Large</option>
            </select>
          </label>
        </>
      ) : null}
      {station === 'printing' ? (
        <>
          <label>
            Queue density
            <select
              value={prefs.queueDensity}
              onChange={(e) =>
                updatePrefs({ queueDensity: e.target.value as 'comfortable' | 'compact' })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label>
            Photo thumbnails
            <select
              value={prefs.thumbnailSize}
              onChange={(e) =>
                updatePrefs({ thumbnailSize: e.target.value as 'comfortable' | 'large' })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={prefs.showCompleted}
              onChange={(e) => updatePrefs({ showCompleted: e.target.checked })}
            />
            Show completed customers
          </label>
        </>
      ) : null}
      {extra}
      <Button onClick={resetPrefs}>Reset station preferences</Button>
      <Link className="text-link" to="/settings">
        Operator setup →
      </Link>
      <Button onClick={() => void post('/logout').then(refresh)}>
        <LogOut size={16} />
        Lock station
      </Button>
    </div>
  );
}
export function StationLayout({
  children,
  ticket,
  action,
  back,
  status,
  settingsExtra,
  error,
  edgeToEdge = false,
  showCustomerContext = true,
}: {
  children: ReactNode;
  ticket?: Ticket | null;
  action?: HeaderAction;
  back?: HeaderAction;
  status?: string;
  settingsExtra?: ReactNode;
  error?: ReactNode;
  edgeToEdge?: boolean;
  showCustomerContext?: boolean;
}) {
  const { station, event } = useStation();
  const StationIcon = stationIcons[station];
  const [settings, setSettings] = useState(false);
  return (
    <div
      className={`station-shell ${edgeToEdge ? 'editor-shell' : ''}`}
      style={
        {
          '--brand-primary': event.primaryColor,
          '--accent': event.accentColor,
        } as React.CSSProperties
      }
    >
      <header className="station-header">
        <div className="station-identity">
          <div className="station-name">
            <StationIcon className="brand-mark" size={34} aria-hidden="true" />
            <span>
              <StationTitle station={station} />
              {event.eventName ? <small title={event.eventName}>{event.eventName}</small> : null}
            </span>
          </div>
        </div>
        {showCustomerContext ? (
          <div className="customer-context">
            {ticket ? (
              <>
                <span className="ticket-prefix">Ticket </span>
                {ticket.code}
              </>
            ) : (
              <span className="idle-label">Ready for next customer</span>
            )}
          </div>
        ) : null}
        <div className="header-actions">
          {back ? (
            <Button
              className="secondary-action"
              disabled={back.disabled}
              busy={back.busy}
              blocked={back.blocked}
              onClick={back.onClick}
            >
              <ArrowLeft size={16} />
              <span>{back.label}</span>
            </Button>
          ) : null}
          {action ? (
            <Button
              primary
              busy={action.busy}
              blocked={action.blocked}
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ) : null}
        </div>
      </header>
      <main className={`station-workspace ${edgeToEdge ? 'edge-to-edge' : ''}`}>
        {error ? (
          <div className="workspace-error" role="alert">
            {error}
          </div>
        ) : null}
        {children}
      </main>
      <Footer status={status} onSettings={() => setSettings(true)} />
      <Modal
        opened={settings}
        onClose={() => setSettings(false)}
        title={`${stationNames[station]} settings`}
        centered
      >
        <LocalSettings extra={settingsExtra} onNavigate={() => setSettings(false)} />
      </Modal>
    </div>
  );
}
