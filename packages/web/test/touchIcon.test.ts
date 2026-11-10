import { beforeAll, describe, expect, it } from 'vitest';
import page from '../index.html?raw';
import source from '../design/apple-touch-icon.svg?raw';
import favicon from '../public/favicon.svg?raw';
import dataUrl from '../public/apple-touch-icon.png?inline';

// The icon iOS uses for "Add to Home Screen". It has to be a full opaque square: iOS rounds the corners
// itself and turns every transparent pixel black, so a rounded favicon-style icon would show black corners.
const ORANGE = [247, 107, 21]; // #f76b15, the app's accent

interface Picture {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlace: number;
  /** One [r, g, b, a] per pixel, row by row. */
  pixels: number[][][];
}

/** Reads an 8-bit RGB or RGBA PNG that is not interlaced: enough to look at the pixels of the icon. */
async function readPng(url: string): Promise<Picture> {
  const base64 = url.slice(url.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let header: Omit<Picture, 'pixels'> | undefined;
  const parts: Uint8Array[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const kind = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    const body = bytes.slice(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      const h = new DataView(body.buffer, body.byteOffset);
      header = { width: h.getUint32(0), height: h.getUint32(4), depth: body[8]!, colorType: body[9]!, interlace: body[12]! };
    }
    if (kind === 'IDAT') parts.push(body);
    at += 12 + length;
  }
  if (!header) throw new Error('no IHDR chunk');

  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => (joined.set(p, offset), offset + p.length), 0);
  const stream = new Blob([joined]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const bpp = header.colorType === 6 ? 4 : 3;
  const stride = header.width * bpp;
  const pixels: number[][][] = [];
  let previous = new Uint8Array(stride);
  for (let y = 0, at = 0; y < header.height; y++) {
    const filter = raw[at]!;
    const line = raw.slice(at + 1, at + 1 + stride);
    at += 1 + stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0;
      const b = previous[x]!;
      const c = x >= bpp ? previous[x - bpp]! : 0;
      const predictor =
        filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
      line[x] = (line[x]! + predictor) & 255;
    }
    pixels.push(Array.from({ length: header.width }, (_, x) => [line[x * bpp]!, line[x * bpp + 1]!, line[x * bpp + 2]!, bpp === 4 ? line[x * bpp + 3]! : 255]));
    previous = line;
  }
  return { ...header, pixels };
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

describe('the apple-touch-icon', () => {
  let icon: Picture;
  beforeAll(async () => {
    icon = await readPng(dataUrl);
  });

  it('is 180 by 180, the size iOS asks for on current devices', () => {
    expect([icon.width, icon.height]).toEqual([180, 180]);
    expect(icon.depth).toBe(8);
    expect(icon.interlace).toBe(0);
  });

  it('has no transparent pixel anywhere, because iOS makes those black', () => {
    const lowest = Math.min(...icon.pixels.flatMap((row) => row.map((p) => p[3]!)));
    expect(lowest).toBe(255);
  });

  it('fills the whole square with the app’s orange, so there are no rounded corners of its own', () => {
    const last = icon.width - 1;
    for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last], [last, 90], [0, 90], [90, 0], [90, last]] as const) {
      expect(icon.pixels[y]![x]!.slice(0, 3)).toEqual(ORANGE);
    }
  });

  it('has the white pages of the book in the middle', () => {
    for (const [x, y] of [[65, 85], [115, 85]] as const) expect(icon.pixels[y]![x]!.slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('is linked from the page, with its size', () => {
    expect(page).toMatch(/<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/);
  });
});

describe('the icon’s source', () => {
  const rect = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('rect')!;

  it('is a plain square with no rounding, unlike the favicon', () => {
    expect(rect(source).getAttribute('rx')).toBeNull();
    expect([rect(source).getAttribute('width'), rect(source).getAttribute('height')]).toEqual(['32', '32']);
    expect(rect(favicon).getAttribute('rx')).not.toBeNull();
  });

  it('is the same orange as the favicon and the icon', () => {
    expect(rect(source).getAttribute('fill')).toBe('#f76b15');
    expect(rect(favicon).getAttribute('fill')).toBe('#f76b15');
  });

  it('is well-formed SVG', () => {
    expect(new DOMParser().parseFromString(source, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });
});
