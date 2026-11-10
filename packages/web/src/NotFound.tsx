import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { Link } from 'react-router';

/** For an address no page answers to, and for a profile that is not in this family. */
export default function NotFound() {
  return (
    <Card size="4" className="centered-card">
      <Flex direction="column" gap="3" align="start">
        <Text size="8" aria-hidden="true">
          🔍
        </Text>
        <Heading as="h1" size="6">
          Page not found
        </Heading>
        <Text color="gray">That page is not here. Maybe the link is old.</Text>
        <Button asChild size="3" variant="soft">
          <Link to="/">Back to who’s reading</Link>
        </Button>
      </Flex>
    </Card>
  );
}
