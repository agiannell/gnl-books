import { GearIcon, PersonIcon } from '@radix-ui/react-icons';
import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import type { ProfileSummary } from './queries.ts';

/** "Who's reading?": one big tap target per profile. The choice is only a convenience, not a security boundary. */
export default function ProfilePicker({ familyName, profiles }: { familyName: string; profiles: ProfileSummary[] }) {
  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="1">
        <Heading as="h1" size={{ initial: '7', sm: '8' }}>
          Who’s reading?
        </Heading>
        <Text size="4" color="gray">
          {familyName}
        </Text>
      </Flex>
      <ul className="card-grid">
        {profiles.map((profile) => (
          <li key={profile.id}>
            <Card asChild size="3">
              <Link
                to={`/p/${profile.id}`}
                className="reader-card"
                // The API only accepts `#rrggbb` for a colour, so it is safe to put in a style.
                style={profile.color ? ({ '--reader-color': profile.color } as CSSProperties) : undefined}
              >
                <Flex align="center" gap="4" height="100%">
                  <span className="reader-avatar" aria-hidden="true">
                    {profile.emoji ?? <PersonIcon width={28} height={28} />}
                  </span>
                  <Text size="6" weight="bold">
                    {profile.name}
                  </Text>
                </Flex>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
      <Flex>
        <Button asChild variant="ghost" color="gray" size="2">
          <Link to="/settings">
            <GearIcon aria-hidden="true" />
            Parent settings
          </Link>
        </Button>
      </Flex>
    </Flex>
  );
}
