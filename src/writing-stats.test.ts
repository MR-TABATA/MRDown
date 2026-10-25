import { describe, it, expect } from 'vitest';
import { parseBaselines, noteBaseline, formatDelta, localDay, BASELINE_MAX } from './writing-stats';

describe('baselines', () => {
  it('records the first sighting and keeps it', () => {
    const b = parseBaselines(null, '2026-10-25');
    expect(noteBaseline(b, '/a.md', 100)).toBe(100);
    expect(noteBaseline(b, '/a.md', 250)).toBe(100);
  });
  it('starts over when the day has changed or the store is broken', () => {
    const old = JSON.stringify({ day: '2026-10-24', chars: { '/a.md': 5 } });
    expect(parseBaselines(old, '2026-10-25')).toEqual({ day: '2026-10-25', chars: {} });
    expect(parseBaselines('{not json', '2026-10-25')).toEqual({ day: '2026-10-25', chars: {} });
  });
  it('keeps the same day', () => {
    const raw = JSON.stringify({ day: '2026-10-25', chars: { '/a.md': 5 } });
    expect(parseBaselines(raw, '2026-10-25').chars['/a.md']).toBe(5);
  });
  it('caps how many paths it remembers, dropping the oldest', () => {
    const b = parseBaselines(null, 'd');
    for (let i = 0; i < BASELINE_MAX + 3; i++) noteBaseline(b, `/f${i}.md`, i);
    expect(Object.keys(b.chars)).toHaveLength(BASELINE_MAX);
    expect('/f0.md' in b.chars).toBe(false);
    expect(`/f${BASELINE_MAX + 2}.md` in b.chars).toBe(true);
  });
});

describe('formatDelta', () => {
  it('signs the number', () => {
    expect(formatDelta(1200)).toBe('+1,200');
    expect(formatDelta(-30)).toBe('−30');
    expect(formatDelta(0)).toBe('0');
  });
});

describe('localDay', () => {
  it('formats the local date', () => {
    expect(localDay(new Date(2026, 9, 5))).toBe('2026-10-05');
  });
});
