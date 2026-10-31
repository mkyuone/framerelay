import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
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
    <div className="loading-page">
      <LoaderCircle size={28} className="spin" />
      <span>Opening FrameRelay…</span>
    </div>
  );
}
function StationRoute({ station }: { station: Station }) {
  const { bootstrap, error } = useApp();
  if (error)
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
