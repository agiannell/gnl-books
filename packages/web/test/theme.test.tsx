import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppTheme } from '../src/theme.tsx';
import { useDarkMode } from '../src/useDarkMode.ts';

/** A stand-in for the device's colour setting that can be flipped while the app is open. */
function fakeScheme(initiallyDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const state = { dark: initiallyDark };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-color-scheme: dark') ? state.dark : false,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  }));
  return {
    set(dark: boolean) {
      state.dark = dark;
      act(() => listeners.forEach((listener) => listener({ matches: dark } as MediaQueryListEvent)));
    },
    listeners,
  };
}

const root = (container: HTMLElement) => container.querySelector('.radix-themes')!;

afterEach(() => vi.unstubAllGlobals());

describe('AppTheme', () => {
  it('is light on a device set to light', () => {
    fakeScheme(false);
    const { container } = render(<AppTheme>hi</AppTheme>);
    expect(root(container).classList.contains('light')).toBe(true);
    expect(root(container).classList.contains('dark')).toBe(false);
  });

  it('is dark on a device set to dark', () => {
    fakeScheme(true);
    const { container } = render(<AppTheme>hi</AppTheme>);
    expect(root(container).classList.contains('dark')).toBe(true);
    expect(root(container).classList.contains('light')).toBe(false);
  });

  it('follows the device when its setting changes while the app is open', () => {
    const scheme = fakeScheme(false);
    const { container } = render(<AppTheme>hi</AppTheme>);
    scheme.set(true);
    expect(root(container).classList.contains('dark')).toBe(true);
    scheme.set(false);
    expect(root(container).classList.contains('light')).toBe(true);
  });

  it('stops listening when it goes away', () => {
    const scheme = fakeScheme(false);
    const { unmount } = render(<AppTheme>hi</AppTheme>);
    expect(scheme.listeners.size).toBe(1);
    unmount();
    expect(scheme.listeners.size).toBe(0);
  });

  it('is the warm orange on sand grey, with rounded corners', () => {
    fakeScheme(false);
    const { container } = render(<AppTheme>hi</AppTheme>);
    const theme = root(container);
    expect(theme.getAttribute('data-accent-color')).toBe('orange');
    expect(theme.getAttribute('data-gray-color')).toBe('sand');
    expect(theme.getAttribute('data-radius')).toBe('large');
  });

  it('shows what is inside it', () => {
    fakeScheme(false);
    const { getByText } = render(<AppTheme>hello there</AppTheme>);
    expect(getByText('hello there')).toBeTruthy();
  });
});

describe('useDarkMode', () => {
  function Probe() {
    return <p>{useDarkMode() ? 'dark' : 'light'}</p>;
  }

  it('reads the setting, light by default when the browser cannot say', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { getByText } = render(<Probe />);
    expect(getByText('light')).toBeTruthy();
  });

  it('reads dark when the device is dark', () => {
    fakeScheme(true);
    const { getByText } = render(<Probe />);
    expect(getByText('dark')).toBeTruthy();
  });
});
