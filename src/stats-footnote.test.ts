// The app registers the footnote extension (main.ts); the statistics run beside
// the preview on the same `marked`, so they are tested with it registered.
import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import markedFootnote from 'marked-footnote';
import { docCounts, docOverview, docStats, readableText } from './markdown';

marked.use(markedFootnote());

const WITH_NOTE = 'Text[^1] here.\n\n[^1]: referenced note\n';
const hasSection = () => String(marked.parse(WITH_NOTE)).includes('data-footnotes');

describe('statistics beside the footnote extension', () => {
  it('leave the preview of a document with footnotes intact', () => {
    expect(hasSection()).toBe(true);
    docStats(WITH_NOTE);
    expect(hasSection()).toBe(true);
    docCounts(WITH_NOTE);
    expect(hasSection()).toBe(true);
    docOverview(WITH_NOTE);
    expect(hasSection()).toBe(true);
  });
  it('count a referenced definition once, and skip an unreferenced one', () => {
    const text = readableText('Text[^1] here.\n\n[^1]: referenced note\n\n[^2]: unreferenced note\n');
    expect(text.match(/referenced note/g)).toHaveLength(1);
    expect(text).not.toContain('unreferenced');
  });
});

describe('callout markers in the statistics', () => {
  it('are not counted, as the preview does not draw them', () => {
    const s = docStats('> [!NOTE]\n> body\n');
    expect(s.chars).toBe(4);
    expect(s.words).toBe(1);
  });
  it('leave an ordinary quote, and an unknown kind, as they are', () => {
    expect(docStats('> quote\n').chars).toBe(5);
    expect(docStats('> [!BOGUS]\n> body\n').chars).toBe('[!BOGUS]body'.length);
  });
});
