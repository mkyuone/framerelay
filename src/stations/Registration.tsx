import { useState } from 'react';
import { QrCode as QrIcon } from 'lucide-react';
import type { Ticket } from '../../shared/types';
import { useStation } from '../context';
import { api, post } from '../lib/api';
import { useLocal, useTask } from '../lib/hooks';
import { useCurrentTicket } from '../lib/ticket';
import { StationLayout } from '../components/StationLayout';
import { QrCode } from '../components/QrCode';
import { Empty, Notice } from '../components/Ui';

export default function Registration() {
  const { event, prefs } = useStation(),
    { ticket, setTicket, loadError } = useCurrentTicket(),
    task = useTask();
  const [previousId, setPreviousId] = useLocal<string | null>(
      `framerelay.v1.${event.id}.registration.previous`,
      null,
    ),
    [previous, setPrevious] = useState<Ticket | null>(null);
  const [key, setKey] = useLocal(
    `framerelay.v1.${event.id}.registration.request`,
    crypto.randomUUID(),
  );
  const displayed = previous ?? ticket;
  async function next() {
    await task.run(async () => {
      const next = await post<Ticket>('/tickets', { key });
      setPreviousId(ticket?.id ?? null);
      setTicket(next);
      setPrevious(null);
      setKey(crypto.randomUUID());
    }, 'next');
  }
  return (
    <StationLayout
      ticket={displayed}
      error={loadError}
      action={{
        label: ticket ? 'Next customer' : 'Create first ticket',
        onClick: () => void next(),
        busy: task.busy && task.operation === 'next',
        blocked: task.busy && task.operation !== 'next',
        disabled: !!previous,
      }}
      back={
        previous
          ? { label: 'Current ticket', onClick: () => setPrevious(null) }
          : previousId
            ? {
                label: 'Previous ticket',
                busy: task.busy && task.operation === 'previous',
                blocked: task.busy && task.operation !== 'previous',
                onClick: () =>
                  void task.run(
                    async () => setPrevious(await api<Ticket>(`/tickets/${previousId}`)),
                    'previous',
                  ),
              }
            : undefined
      }
      status={
        previous
          ? 'Showing previous ticket'
          : task.busy && task.operation === 'next'
            ? 'Creating ticket'
            : undefined
      }
    >
      {displayed ? (
        <div className="registration-content">
          <div className="qr-title">
            <h1>{previous ? 'Previous customer ticket' : 'Your ticket to a good memory.'}</h1>
            <p>Photograph this code to keep your ticket.</p>
          </div>
          <QrCode
            value={`${location.origin}/s/${displayed.identificationToken}`}
            label={`Customer ticket ${displayed.code}`}
            size={prefs.qrSize}
          />
          <div className="ticket-label">{displayed.code}</div>
          <Notice>{task.error}</Notice>
        </div>
      ) : (
        <Empty icon={<QrIcon size={50} />} title="Ready when you are.">
          <p>Create a ticket after collecting payment.</p>
          <Notice>{task.error}</Notice>
        </Empty>
      )}
    </StationLayout>
  );
}
