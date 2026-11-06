import { describe, expect, it } from 'vitest';
import { err, ok } from './index.js';

describe('Result', () => {
  it('wraps a value with ok()', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('wraps an error with err()', () => {
    expect(err('BOOM')).toEqual({ ok: false, error: 'BOOM' });
  });
});
