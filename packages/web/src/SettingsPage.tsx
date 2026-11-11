import { Button, Flex, Heading } from '@radix-ui/themes';
import { Link } from 'react-router';
import ExportSection from './ExportSection.tsx';
import GoalsSection from './GoalsSection.tsx';
import JoinRequestsSection from './JoinRequestsSection.tsx';
import ParentGate from './ParentGate.tsx';
import ProfilesSection from './ProfilesSection.tsx';
import TimezoneSection from './TimezoneSection.tsx';

/** Everything only a parent may change. Behind the PIN; the sections arrive one at a time. */
export default function SettingsPage() {
  return (
    <Flex direction="column" gap="5">
      <ParentGate>
        <Heading as="h1" size={{ initial: '7', sm: '8' }}>
          Settings
        </Heading>
        <ProfilesSection />
        <JoinRequestsSection />
        <GoalsSection />
        <TimezoneSection />
        <ExportSection />
      </ParentGate>
      <Flex>
        <Button asChild variant="ghost" color="gray">
          <Link to="/">Back to who’s reading</Link>
        </Button>
      </Flex>
    </Flex>
  );
}
