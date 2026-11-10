import { render, screen } from '@testing-library/react';
import { TextField } from '@radix-ui/themes';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Alert, Field, Loading, Panel, Status, TextLink } from '../src/ui.tsx';

describe('Alert', () => {
  it('is announced as an alert, with its words', () => {
    render(<Alert>Something went wrong: boom</Alert>);
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong: boom');
  });

  it('is not a status', () => {
    render(<Alert>x</Alert>);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Status', () => {
  it('is announced politely as a status, with its words', () => {
    render(<Status>Added to Read</Status>);
    expect(screen.getByRole('status').textContent).toBe('Added to Read');
  });

  it('is not an alert', () => {
    render(<Status>x</Status>);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Loading', () => {
  it('says "Loading…" unless told otherwise', () => {
    render(<Loading />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  it('can say something else', () => {
    render(<Loading>Searching…</Loading>);
    expect(screen.getByText('Searching…')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('Field', () => {
  it('names the control inside it, so it can be found and focused by its label', () => {
    render(
      <Field label="Parent PIN">
        <TextField.Root />
      </Field>,
    );
    expect(screen.getByLabelText('Parent PIN').tagName).toBe('INPUT');
  });

  it('keeps two fields apart', () => {
    render(
      <>
        <Field label="Name">
          <input />
        </Field>
        <Field label="Name again">
          <input />
        </Field>
      </>,
    );
    expect(screen.getByLabelText('Name')).not.toBe(screen.getByLabelText('Name again'));
  });

  it('works with a native select, whose options are not part of the label', () => {
    render(
      <Field label="Shelf">
        <select>
          <option>Want to read</option>
        </select>
      </Field>,
    );
    expect(screen.getByLabelText('Shelf').tagName).toBe('SELECT');
  });
});

describe('Panel', () => {
  it('is a landmark named by its own heading', () => {
    render(
      <Panel id="x-heading" title="Readers">
        <p>inside</p>
      </Panel>,
    );
    const region = screen.getByRole('region', { name: 'Readers' });
    expect(region.contains(screen.getByText('inside'))).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: 'Readers' })).toBeTruthy();
  });
});

describe('TextLink', () => {
  it('is an ordinary link to the page it names', () => {
    render(
      <MemoryRouter>
        <TextLink to="/p/p-2/add">Add it yourself</TextLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Add it yourself' }).getAttribute('href')).toBe('/p/p-2/add');
  });
});
