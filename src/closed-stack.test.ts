import { describe, it, expect } from 'vitest';
import { pushClosed, popReopenable, requeueClosed } from './closed-stack';

describe('pushClosed', () => {
  it('moves a repeated path to the newest slot instead of duplicating it', () => {
    const s = ['a', 'b'];
    pushClosed(s, 'a');
    expect(s).toEqual(['b', 'a']);
  });
  it('drops the oldest beyond the cap', () => {
    const s: string[] = [];
    for (const p of ['a', 'b', 'c', 'd']) pushClosed(s, p, 3);
    expect(s).toEqual(['b', 'c', 'd']);
  });
});

describe('popReopenable', () => {
  const yes = async () => true;
  it('returns the most recently closed first', async () => {
    const s = ['a', 'b', 'c'];
    expect(await popReopenable(s, () => false, yes)).toBe('c');
    expect(await popReopenable(s, () => false, yes)).toBe('b');
    expect(s).toEqual(['a']);
  });
  it('skips what is already open or no longer exists', async () => {
    const s = ['a', 'b', 'c'];
    const got = await popReopenable(s, (p) => p === 'c', async (p) => p !== 'b');
    expect(got).toBe('a');
    expect(s).toEqual([]);
  });
  it('returns null when nothing is left', async () => {
    expect(await popReopenable([], () => false, yes)).toBeNull();
    expect(await popReopenable(['x'], () => false, async () => false)).toBeNull();
  });
});

describe('requeueClosed', () => {
  it('puts a path that failed to open at the oldest end, not the top', () => {
    const s = ['a', 'b'];
    requeueClosed(s, 'x');
    expect(s).toEqual(['x', 'a', 'b']);
  });
  it('does nothing if the path is already there or the stack is full', () => {
    const s = ['a'];
    requeueClosed(s, 'a');
    expect(s).toEqual(['a']);
    const full = ['a', 'b'];
    requeueClosed(full, 'x', 2);
    expect(full).toEqual(['a', 'b']);
  });
});
