import { CheckCircledIcon, ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { Callout, Card, Flex, Heading, Link as ThemeLink, Spinner, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { Link as RouterLink, type LinkProps } from 'react-router';

/** A link inside a sentence, in the theme's colour: a router link, so it never reloads the page. */
export function TextLink(props: LinkProps) {
  return (
    <ThemeLink asChild>
      <RouterLink {...props} />
    </ThemeLink>
  );
}

/** One box on a page: a labelled region (a landmark a screen reader can jump to) with its own heading. */
export function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card asChild size="3">
      <section aria-labelledby={id}>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4" id={id}>
            {title}
          </Heading>
          {children}
        </Flex>
      </section>
    </Card>
  );
}

/** Something went wrong, in a red box that a screen reader announces. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <Callout.Root color="red" size="1" role="alert">
      <Callout.Icon>
        <ExclamationTriangleIcon />
      </Callout.Icon>
      <Callout.Text>{children}</Callout.Text>
    </Callout.Root>
  );
}

/** Something worked, in a green box that a screen reader announces politely. */
export function Status({ children }: { children: ReactNode }) {
  return (
    <Callout.Root color="green" size="1" role="status">
      <Callout.Icon>
        <CheckCircledIcon />
      </Callout.Icon>
      <Callout.Text>{children}</Callout.Text>
    </Callout.Root>
  );
}

/** A spinner with words, for anything still on its way. */
export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return (
    <Flex align="center" gap="2" role="status" aria-live="polite">
      <Spinner />
      <Text color="gray">{children}</Text>
    </Flex>
  );
}

/** A label above its control. The control sits inside the label, so clicking the words focuses it. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <Text as="span" size="2" weight="medium">
        {label}
      </Text>
      {children}
    </label>
  );
}
