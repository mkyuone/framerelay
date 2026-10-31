import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Aperture, ArrowLeft } from 'lucide-react';
import { Modal } from '@mantine/core';
import type { EventConfig } from '../../shared/types';
import { useApp } from '../context';
import { post } from '../lib/api';
import { useTask } from '../lib/hooks';
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
  const { bootstrap, refresh } = useApp(),
    task = useTask();
  const current = bootstrap?.event;
  const [draft, setDraft] = useState<Draft>(() =>
    current ? { ...current, staffPasscode: '' } : { ...blank },
  );
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const update = (fields: Partial<Draft>) => setDraft((value) => ({ ...value, ...fields }));
  async function save() {
    await task.run(async () => {
      await post('/settings', draft);
      update({ staffPasscode: '' });
      await refresh();
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
          <strong>Setup</strong>
        </div>
        <span>FrameRelay</span>
      </header>
      <section className="setup-body">
        <Notice>{task.error}</Notice>
        <>
          <div className="setup-step-heading">
            <div>
              <h1>Customize FrameRelay.</h1>
              <p>Choose the settings used by your stations. You can change them at any time.</p>
            </div>
          </div>
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label>
              Display name (optional)
              <input
                value={draft.eventName}
                onChange={(e) => update({ eventName: e.target.value })}
                maxLength={160}
                autoFocus
              />
            </label>
            <label>
              Staff passcode
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={draft.staffPasscode}
                onChange={(e) => update({ staffPasscode: e.target.value })}
                required={!current}
                placeholder={current ? 'Leave blank to keep the current passcode' : undefined}
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
                <p className="field-hint">
                  Changing delivery settings affects current customers and downloads.
                </p>
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
              <Button
                primary
                type="submit"
                busy={task.busy}
                disabled={!draft.printEnabled && !draft.digitalEnabled}
              >
                Save settings
              </Button>
            </div>
          </form>
        </>
        {current ? (
          <div className="setup-step-heading">
            <div>
              <h2>Start fresh</h2>
              <p>
                Clear all customer data when you are finished. Your settings and staff passcode stay
                in place.
              </p>
            </div>
            <Button
              onClick={() => {
                setConfirmation('');
                setResetOpen(true);
              }}
            >
              Clear all data
            </Button>
          </div>
        ) : null}
      </section>
      <Modal
        opened={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Clear all customer data?"
        centered
      >
        <p>
          This permanently deletes all tickets, photos, print queues and customer download links,
          including those from previous events. Finish all work and back up anything you need first.
          Settings and the staff passcode will be kept.
        </p>
        <label>
          Type CLEAR to confirm
          <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </label>
        <Notice>{task.error}</Notice>
        <div className="modal-actions">
          <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button
            primary
            busy={task.busy}
            disabled={confirmation !== 'CLEAR'}
            onClick={() =>
              void task.run(async () => {
                await post('/reset');
                setResetOpen(false);
                await refresh();
              })
            }
          >
            Clear all data
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
