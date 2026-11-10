import { useEffect, useState } from 'react';

const DARK = '(prefers-color-scheme: dark)';

/** Whether the device is set to dark mode, kept up to date if the setting changes while the app is open. */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia?.(DARK).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(DARK);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return dark;
}
