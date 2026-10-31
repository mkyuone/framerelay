import { useId, useState } from 'react';
import { useTask } from '../lib/hooks';
import { Button, Notice } from './Ui';

export function PasscodePrompt({
  message,
  label,
  buttonText,
  onUnlock,
}: {
  message: string;
  label: string;
  buttonText: string;
  onUnlock: (passcode: string) => Promise<void>;
}) {
  const id = useId(),
    [passcode, setPasscode] = useState(''),
    task = useTask();
  return (
    <main className="access-page">
      <div className="access-card access-simple">
        <h1>{message}</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void task.run(() => onUnlock(passcode));
          }}
        >
          <label className="sr-only" htmlFor={id}>
            {label}
          </label>
          <input
            id={id}
            type="password"
            placeholder="Passcode"
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            required
            autoFocus
          />
          <Notice>{task.error}</Notice>
          <Button primary type="submit" busy={task.busy}>
            {buttonText}
          </Button>
        </form>
      </div>
    </main>
  );
}
