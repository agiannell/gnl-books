import { Link } from 'react-router';
import type { ProfileSummary } from './queries.ts';

/** "Who's reading?": one big tap target per profile. The choice is only a convenience, not a security boundary. */
export default function ProfilePicker({ familyName, profiles }: { familyName: string; profiles: ProfileSummary[] }) {
  return (
    <>
      <h1>Who’s reading?</h1>
      <p>{familyName}</p>
      <ul className="profiles">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <Link to={`/p/${profile.id}`} className="profile" style={profile.color ? { borderColor: profile.color } : undefined}>
              {profile.emoji && <span aria-hidden="true">{profile.emoji}</span>}
              {profile.name}
            </Link>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/settings">Parent settings</Link>
      </p>
    </>
  );
}
