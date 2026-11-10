import { Link } from 'react-router';
import ParentGate from './ParentGate.tsx';
import ProfilesSection from './ProfilesSection.tsx';

/** Everything only a parent may change. Behind the PIN; the sections arrive one at a time. */
export default function SettingsPage() {
  return (
    <>
      <ParentGate>
        <h1>Settings</h1>
        <ProfilesSection />
      </ParentGate>
      <p>
        <Link to="/">Back to who’s reading</Link>
      </p>
    </>
  );
}
