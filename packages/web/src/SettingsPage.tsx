import { Link } from 'react-router';
import ParentGate from './ParentGate.tsx';

/** Everything only a parent may change. Behind the PIN; the sections arrive one at a time. */
export default function SettingsPage() {
  return (
    <>
      <ParentGate>
        <h1>Settings</h1>
        <p>Nothing to change here yet.</p>
      </ParentGate>
      <p>
        <Link to="/">Back to who’s reading</Link>
      </p>
    </>
  );
}
