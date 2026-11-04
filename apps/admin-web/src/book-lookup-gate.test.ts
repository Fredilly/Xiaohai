import { describe, expect, it } from 'vitest';
import { createBookLookupGate } from './book-lookup-gate';

describe('HQ ISBN lookup request freshness', () => {
  it('rejects older replies when a newer ISBN search has started', async () => {
    const gate = createBookLookupGate();
    const oldRequest = gate.start();
    const newRequest = gate.start();
    const newer = await Promise.resolve({ title: 'New ISBN result' });
    const older = await Promise.resolve({ title: 'Old ISBN result' });
    let title = '';
    if (gate.current(newRequest)) title = newer.title;
    if (gate.current(oldRequest)) title = older.title;
    expect(title).toBe('New ISBN result');
  });

  it('rejects pending reply after manual ISBN, title or price edit and unmount', () => {
    const gate = createBookLookupGate();
    const pending = gate.start();
    gate.invalidate();
    expect(gate.current(pending)).toBe(false);
    const next = gate.start();
    expect(gate.current(next)).toBe(true);
    gate.invalidate();
    expect(gate.current(next)).toBe(false);
  });
});
