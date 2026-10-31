import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Aperture, ArrowLeft, Plus } from 'lucide-react';
import { Modal } from '@mantine/core';
import type { EventConfig } from '../../shared/types';
import { useApp } from '../context';
import { api, patch, post } from '../lib/api';
import { usePolling, useTask } from '../lib/hooks';
import { Button, Notice } from '../components/Ui';
import { PasscodePrompt } from '../components/PasscodePrompt';

type Draft = Omit<EventConfig, 'id' | 'status' | 'downloadsEnabled'> & {
  id?: string;
  staffPasscode: string;
};
const blank: Draft = {
  eventName: '',
  primaryColor: '#101D40',
  accentColor: '#1162D4',
  footerText: '',
  selectionLimit: 1,
  printEnabled: true,
  digitalEnabled: true,
  printWidth: 6,
  printHeight: 4,
  copies: 1,
  staffPasscode: '',
};

function OperatorLogin() {
  const { refresh } = useApp();
  return (
    <PasscodePrompt
      message="Enter the operator passcode"
      label="Operator passcode"
      buttonText="Unlock setup"
      onUnlock={async (passcode) => {
        await post('/login', { kind: 'operator', passcode });
        await refresh();
      }}
    />
  );
}

function SetupContent() {
  const { refresh } = useApp(),
    list = usePolling(() => api<EventConfig[]>('/events'), 10000),
    task = useTask();
  const [draft, setDraft] = useState<Draft | null>(null),
    [closeId, setCloseId] = useState<string | null>(null);
  const active = list.value?.find((event) => event.status === 'active');
  const update = (fields: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...fields } : null));
  async function activate() {
    await task.run(async () => {
      const saved = await post<EventConfig>('/events', draft);
      update({ id: saved.id });
      await post(`/events/${saved.id}/activate`);
      setDraft(null);
      await Promise.all([list.refresh(), refresh()]);
    });
  }
  return (
    <main className="setup-page">
      <header className="setup-header">
        <Link to="/registration" className="button">
          <ArrowLeft size={18} />
          Stations
        </Link>
        <div>
          <Aperture size={26} />
          <strong>Event setup</strong>
        </div>
        <span>FrameRelay</span>
      </header>
      <section className="setup-body">
        <Notice>{task.error || list.error}</Notice>
        {draft ? (
          <>
            <div className="setup-step-heading">
              <div>
                <h1>Set up your event.</h1>
                <p>A name is optional. Settings lock when you activate.</p>
              </div>
            </div>
            <form
              className="setup-form"
              onSubmit={(e) => {
                e.preventDefault();
                void activate();
              }}
            >
              <label>
                Event name (optional)
                <input
                  value={draft.eventName}
                  onChange={(e) => update({ eventName: e.target.value })}
                  maxLength={160}
                  autoFocus
                />
              </label>
              <label>
                Shared event passcode
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={draft.staffPasscode}
                  onChange={(e) => update({ staffPasscode: e.target.value })}
                  required
                />
              </label>
              <details className="setup-options">
                <summary>Delivery settings</summary>
                <div>
                  <label>
                    Maximum final photos
                    <select
                      value={draft.selectionLimit}
                      onChange={(e) => update({ selectionLimit: Number(e.target.value) })}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-row">
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={draft.printEnabled}
                        onChange={(e) => update({ printEnabled: e.target.checked })}
                      />
                      Printing enabled
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={draft.digitalEnabled}
                        onChange={(e) => update({ digitalEnabled: e.target.checked })}
                      />
                      Digital downloads enabled
                    </label>
                  </div>
                  {draft.printEnabled ? (
                    <div className="form-row">
                      <label>
                        Paper width (in)
                        <input
                          type="number"
                          min={1}
                          max={36}
                          step={0.1}
                          value={draft.printWidth}
                          onChange={(e) => update({ printWidth: Number(e.target.value) })}
                          required
                        />
                      </label>
                      <label>
                        Paper height (in)
                        <input
                          type="number"
                          min={1}
                          max={36}
                          step={0.1}
                          value={draft.printHeight}
                          onChange={(e) => update({ printHeight: Number(e.target.value) })}
                          required
                        />
                      </label>
                      <label>
                        Copies per final
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={draft.copies}
                          onChange={(e) => update({ copies: Number(e.target.value) })}
                          required
                        />
                      </label>
                    </div>
                  ) : null}
                  <p className="field-hint">Downloads remain available until manually disabled.</p>
                </div>
              </details>
              <details className="setup-options">
                <summary>Appearance</summary>
                <div>
                  <label>
                    Default footer text
                    <input
                      value={draft.footerText}
                      onChange={(e) => update({ footerText: e.target.value })}
                      maxLength={240}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Primary color
                      <input
                        type="color"
                        value={draft.primaryColor}
                        onChange={(e) => update({ primaryColor: e.target.value })}
                      />
                    </label>
                    <label>
                      Accent color
                      <input
                        type="color"
                        value={draft.accentColor}
                        onChange={(e) => update({ accentColor: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              </details>
              {!draft.printEnabled && !draft.digitalEnabled ? (
                <Notice>Enable printing or digital downloads.</Notice>
              ) : null}
              <div className="setup-actions">
                <Button onClick={() => setDraft(null)}>Cancel</Button>
                <Button
                  primary
                  type="submit"
                  busy={task.busy}
                  disabled={!draft.printEnabled && !draft.digitalEnabled}
                >
                  Activate event
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="setup-step-heading">
              <div>
                <h1>{active ? 'Your event is running.' : 'Ready for a new event.'}</h1>
                <p>One active event. Every photo in its place.</p>
              </div>
              <Button primary disabled={!!active} onClick={() => setDraft({ ...blank })}>
                <Plus size={18} />
                New event
              </Button>
            </div>
            <div className="event-list">
              {list.value?.map((event) => (
                <article key={event.id} className="event-row">
                  <div>
                    <strong>{event.eventName || 'Untitled event'}</strong>
                    <small>
                      {event.status === 'active'
                        ? 'Active · settings locked'
                        : event.status === 'closed'
                          ? 'Closed · settings preserved'
                          : 'Draft'}
                    </small>
                  </div>
                  <div>
                    {event.digitalEnabled ? (
                      <Button
                        onClick={() =>
                          void task.run(async () => {
                            await patch(`/events/${event.id}/downloads`, {
                              enabled: !event.downloadsEnabled,
                            });
                            await list.refresh();
                          })
                        }
                      >
                        {event.downloadsEnabled ? 'Disable downloads' : 'Enable downloads'}
                      </Button>
                    ) : null}
                    {event.status === 'active' ? (
                      <Button onClick={() => setCloseId(event.id)}>Close event</Button>
                    ) : event.status === 'draft' ? (
                      <Button onClick={() => setDraft({ ...event, staffPasscode: '' })}>
                        Edit draft
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
              {!list.value?.length ? (
                <p className="muted">Create your first event to open the stations.</p>
              ) : null}
            </div>
          </>
        )}
      </section>
      <Modal opened={!!closeId} onClose={() => setCloseId(null)} title="Close this event?" centered>
        <p>
          Finish outstanding customers and printing first. Closing locks staff access to this event.
          Existing public downloads remain available until disabled.
        </p>
        <div className="modal-actions">
          <Button onClick={() => setCloseId(null)}>Keep open</Button>
          <Button
            primary
            busy={task.busy}
            onClick={() =>
              void task.run(async () => {
                await post(`/events/${closeId}/close`);
                setCloseId(null);
                await Promise.all([list.refresh(), refresh()]);
              })
            }
          >
            Close event
          </Button>
        </div>
      </Modal>
    </main>
  );
}
export default function Setup() {
  const { bootstrap } = useApp();
  return bootstrap?.operator ? <SetupContent /> : <OperatorLogin />;
}
