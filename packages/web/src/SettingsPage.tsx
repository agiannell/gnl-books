import { Link } from 'react-router';
import GoalsSection from './GoalsSection.tsx';
import ParentGate from './ParentGate.tsx';
import ProfilesSection from './ProfilesSection.tsx';

/** Everything only a parent may change. Behind the PIN; the sections arrive one at a time. */
export default function SettingsPage() {
  return (
    <>
      <ParentGate>
        <h1>Settings</h1>
        <ProfilesSection />
        <GoalsSection />
      </ParentGate>
      <p>
        <Link to="/">Back to who’s reading</Link>
      </p>
    </>
  );
}
