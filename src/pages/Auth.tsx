import { useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { post } from '../lib/api';
import { PasscodePrompt } from '../components/PasscodePrompt';

export default function Auth() {
  const { bootstrap, refresh } = useApp(),
    navigate = useNavigate();
  const hasEvent = !!bootstrap?.event;
  return (
    <PasscodePrompt
      message={hasEvent ? 'Enter the staff passcode' : 'Enter the operator passcode'}
      label={hasEvent ? 'Staff passcode' : 'Operator passcode'}
      buttonText={hasEvent ? 'Open station' : 'Open setup'}
      onUnlock={async (passcode) => {
        await post('/login', { kind: hasEvent ? 'staff' : 'operator', passcode });
        await refresh();
        if (!hasEvent) navigate('/settings');
      }}
    />
  );
}
