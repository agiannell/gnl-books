import { describe, expect, it } from 'vitest';
import page from '../index.html?raw';
import svg from '../public/favicon.svg?raw';

// The site's icon is a file in public/ that the page names in index.html. Nothing else uses it, so
// nothing else would notice if it were deleted, broken, or still the scaffold's.

describe('the favicon', () => {
  it('is the file the page names as its icon', () => {
    expect(page).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
  });

  it('is well-formed SVG with a viewBox, so it scales to any tab size', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const svgElement = doc.documentElement;
    expect(svgElement.tagName).toBe('svg');
    expect(svgElement.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(svgElement.getAttribute('viewBox')).toBe('0 0 32 32');
  });

  it('draws something: a background and the book', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelectorAll('rect').length).toBe(1);
    expect(doc.querySelectorAll('path').length).toBeGreaterThanOrEqual(1);
  });

  it('holds no script, no outside address and no embedded image', () => {
    expect(svg).not.toMatch(/<script|<image|<foreignObject|onload|javascript:/i);
    // The only address allowed is the SVG namespace itself.
    expect(svg.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
  });

  it('is small: the scaffold’s was 9 kB', () => {
    expect(new TextEncoder().encode(svg).length).toBeLessThan(1024);
  });

  it('is not the scaffold’s lightning bolt', () => {
    expect(svg).not.toContain('#863bff');
  });
});
