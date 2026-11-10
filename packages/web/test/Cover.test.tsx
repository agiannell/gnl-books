import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Cover from '../src/Cover.tsx';

const HARDCOVER = 'https://assets.hardcover.app/books/123/cover.jpg';
const img = (container: HTMLElement) => container.querySelector('img');
const placeholder = (container: HTMLElement) => container.querySelector('.cover-placeholder');

describe('Cover', () => {
  it('shows the picture, as decoration, without telling Hardcover which site it is on', () => {
    const { container } = render(<Cover url={HARDCOVER} />);
    const picture = img(container)!;
    expect(picture.getAttribute('src')).toBe(HARDCOVER);
    // The title is written beside it, so the picture carries no words of its own.
    expect(picture.getAttribute('alt')).toBe('');
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(picture.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(picture.getAttribute('loading')).toBe('lazy');
    expect(placeholder(container)).toBeNull();
  });

  it.each([null, undefined, ''])('shows a book on a tile when there is no address (%j)', (url) => {
    const { container } = render(<Cover url={url} />);
    expect(img(container)).toBeNull();
    expect(placeholder(container)).not.toBeNull();
  });

  // The site's content security policy allows covers from Hardcover over https and nothing else, so
  // anything else would only produce a blocked request.
  it.each([
    'http://assets.hardcover.app/x.jpg',
    '//assets.hardcover.app/x.jpg',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    '/covers/x.jpg',
    'ftp://example.com/x.jpg',
  ])('does not try %j, and shows the tile instead', (url) => {
    const { container } = render(<Cover url={url} />);
    expect(img(container)).toBeNull();
    expect(placeholder(container)).not.toBeNull();
  });

  it('falls back to the tile when the picture will not load', () => {
    const { container } = render(<Cover url={HARDCOVER} />);
    fireEvent.error(img(container)!);
    expect(img(container)).toBeNull();
    expect(placeholder(container)).not.toBeNull();
  });

  it('stays on the tile for the address that failed, but tries a different book’s address', () => {
    const { container, rerender } = render(<Cover url={HARDCOVER} />);
    fireEvent.error(img(container)!);
    rerender(<Cover url={HARDCOVER} />);
    expect(img(container)).toBeNull();
    const other = 'https://assets.hardcover.app/books/456/cover.jpg';
    rerender(<Cover url={other} />);
    expect(img(container)!.getAttribute('src')).toBe(other);
  });

  it.each([
    ['sm', 'cover-sm'],
    ['md', 'cover-md'],
    ['lg', 'cover-lg'],
  ] as const)('is %s-sized when asked', (size, className) => {
    const { container } = render(<Cover url={null} size={size} />);
    expect(container.firstElementChild!.classList.contains(className)).toBe(true);
  });

  it('is medium unless told otherwise', () => {
    const { container } = render(<Cover url={null} />);
    expect(container.firstElementChild!.classList.contains('cover-md')).toBe(true);
  });
});
