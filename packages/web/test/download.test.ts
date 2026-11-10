import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile, exportFileName } from '../src/download.ts';

describe('exportFileName', () => {
  it.each([
    ['Sam', 'sam-books.csv'],
    ['Mary Jane', 'mary-jane-books.csv'],
    ['Kid 2', 'kid-2-books.csv'],
    ['José', 'jose-books.csv'],
    ['Zoë', 'zoe-books.csv'],
    ['O’Brien', 'o-brien-books.csv'],
    ['  --Kit--  ', 'kit-books.csv'],
    ['A/B\\C', 'a-b-c-books.csv'],
    ['../etc/passwd', 'etc-passwd-books.csv'],
    ['🦊', 'reader-books.csv'],
    ['', 'reader-books.csv'],
    ['名前', 'reader-books.csv'],
  ])('turns %j into %j', (name, fileName) => {
    expect(exportFileName(name)).toBe(fileName);
  });

  it('never gives a path, a dot or a space', () => {
    for (const name of ['a b', 'a.b', 'a/b', '..', ' ', 'a\nb', 'a\tb']) {
      const [stem] = exportFileName(name).split('.csv');
      expect(stem).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('downloadTextFile', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  // Records what the link looked like at the moment it was clicked, since it is removed straight after.
  function watch() {
    const order: string[] = [];
    const clicked: { href: string; download: string; attached: boolean }[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      order.push('create');
      return 'blob:fake-1';
    });
    URL.revokeObjectURL = vi.fn(() => void order.push('revoke'));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      order.push('click');
      clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
    });
    return { order, clicked, blobs };
  }

  it('saves the text under the given name, from a link that is in the page when it is clicked', () => {
    const { clicked } = watch();
    downloadTextFile('sam-books.csv', 'a,b\n');
    expect(clicked).toEqual([{ href: 'blob:fake-1', download: 'sam-books.csv', attached: true }]);
  });

  it('keeps the text exactly, as a CSV file in UTF-8', async () => {
    const { blobs } = watch();
    const text = 'Title,"Author, Jr."\r\n"Ünï ""q"""\n';
    downloadTextFile('x.csv', text);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe('text/csv;charset=utf-8');
    expect(await blobs[0]!.text()).toBe(text);
  });

  it('takes another type when given one', () => {
    const { blobs } = watch();
    downloadTextFile('x.txt', 'hi', 'text/plain');
    expect(blobs[0]!.type).toBe('text/plain');
  });

  it('removes the link, and lets go of the file only after the click', () => {
    const { order } = watch();
    downloadTextFile('x.csv', 'a');
    expect(order).toEqual(['create', 'click', 'revoke']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
