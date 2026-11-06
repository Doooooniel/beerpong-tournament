import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.js';
import { de } from './shared/i18n/de.js';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe('App routing', () => {
  afterEach(cleanup);

  it('shows the admin panel on /admin', () => {
    renderAt('/admin');
    expect(screen.getByRole('heading', { name: de.admin.title })).toBeTruthy();
  });

  it('shows the beamer view on /beamer', () => {
    renderAt('/beamer');
    expect(screen.getByRole('heading', { name: de.beamer.title })).toBeTruthy();
  });

  it('redirects unknown paths to /admin', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: de.admin.title })).toBeTruthy();
  });
});
