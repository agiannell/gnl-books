import { Card, Flex, Text } from '@radix-ui/themes';
import type { GoalSummary } from './queries.ts';

/** This year's reading goal as a progress bar with the numbers beside it. */
export default function GoalProgress({ goal }: { goal: GoalSummary }) {
  const { year, target, booksRead } = goal;
  const label = `${year} goal: ${booksRead} of ${target} ${target === 1 ? 'book' : 'books'}`;
  return (
    <Card size="3">
      <label>
        <Flex direction="column" gap="2">
          <Text size="4" weight="bold">
            {label}
            {booksRead >= target && ' ✓'}
          </Text>
          {/* A bar cannot show more than full. */}
          <progress value={Math.min(booksRead, target)} max={target} />
        </Flex>
      </label>
    </Card>
  );
}
