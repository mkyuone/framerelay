import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Aperture, LoaderCircle } from 'lucide-react';
import { stations, type Station } from '../shared/types';
import { StationProvider, useApp } from './context';
import { Empty } from './components/Ui';
import Auth from './pages/Auth';
import Registration from './stations/Registration';

const Photography = lazy(() => import('./stations/Photography'));
const Selection = lazy(() => import('./stations/Selection'));
const Printing = lazy(() => import('./stations/Printing'));
const Setup = lazy(() => import('./pages/Setup'));
const Download = lazy(() => import('./pages/Download'));
const views = {
  registration: Registration,
  photography: Photography,
  selection: Selection,
  printing: Printing,
};
function Loading() {
  return (
    <div className="loading-page" role="status" aria-label="Opening FrameRelay">
      <div className="connection-overlay-content">
        <Aperture size={42} aria-hidden="true" />
        <h1>Opening FrameRelay</h1>
        <p>Getting everything ready for you.</p>
        <span className="connection-retrying">
          <LoaderCircle size={18} className="spin" /> Loading…
        </span>
      </div>
    </div>
  );
}
function StationRoute({ station }: { station: Station }) {
  const { bootstrap, error, connection } = useApp();
  if (error && !bootstrap && connection === 'connected')
    return (
      <Empty icon={<LoaderCircle size={30} />} title="Cannot reach FrameRelay">
        <p>{error}</p>
        <button className="button" onClick={() => location.reload()}>
          Reconnect
        </button>
      </Empty>
    );
  if (!bootstrap) return <Loading />;
  if (!bootstrap.staff || !bootstrap.event) return <Auth />;
  const View = views[station];
  return (
    <StationProvider
      key={`${bootstrap.event.id}.${station}`}
      station={station}
      event={bootstrap.event}
    >
      <View />
    </StationProvider>
  );
}
function TicketLink() {
  const { bootstrap } = useApp();
  return (
    <main className="customer-page">
      <Empty icon={null} title="Keep this ticket.">
        <p>Show this QR to a volunteer at photography and selection.</p>
        {bootstrap?.staff ? <p>Scan the code at the appropriate station to continue.</p> : null}
      </Empty>
    </main>
  );
}
export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {stations.map((station) => (
          <Route key={station} path={`/${station}`} element={<StationRoute station={station} />} />
        ))}
        <Route path="/settings" element={<Setup />} />
        <Route path="/d/:token" element={<Download />} />
        <Route path="/s/:token" element={<TicketLink />} />
        <Route path="*" element={<Navigate to="/registration" replace />} />
      </Routes>
    </Suspense>
  );
}
