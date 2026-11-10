import { Theme } from '@radix-ui/themes';
import type { ReactNode } from 'react';
import { useDarkMode } from './useDarkMode.ts';

/**
 * The look of the whole app: warm orange on sand grey, big rounded corners and a little extra size
 * for touch screens. Radix Themes ships ordinary CSS files, so none of this needs a loosened
 * content security policy (see the stack's response headers).
 */
export function AppTheme({ children }: { children: ReactNode }) {
  const dark = useDarkMode();
  return (
    <Theme
      accentColor="orange"
      grayColor="sand"
      radius="large"
      scaling="110%"
      panelBackground="solid"
      appearance={dark ? 'dark' : 'light'}
    >
      {children}
    </Theme>
  );
}
