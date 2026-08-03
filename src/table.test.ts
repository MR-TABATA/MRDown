import { describe, it, expect } from 'vitest';
import { findTables, splitRow, inlineSegments } from './table';

const T = ['| a | b |', '| --- | ---: |', '| 1 | 2 |'].join('\n');

describe('splitRow', () => {
  it('drops the optional outer pipes and trims cells', () => {
    expect(splitRow('| a | b |', 0).map((c) => c.text)).toEqual(['a', 'b']);
    expect(splitRow('a | b', 0).map((c) => c.text)).toEqual(['a', 'b']);
  });

  it('reports each cell at its own source offset', () => {
    const cells = splitRow('| ab | cd |', 100);
    expect(cells.map((c) => [c.from, c.to])).toEqual([
      [102, 104],
      [107, 109],
    ]);
  });

  it('keeps an escaped pipe inside its cell', () => {
    expect(splitRow('| a \\| b | c |', 0).map((c) => c.text)).toEqual(['a \\| b', 'c']);
  });

  it('gives an empty cell a zero-width position after its pipe', () => {
    const cells = splitRow('| a |  | c |', 0);
    expect(cells.map((c) => c.text)).toEqual(['a', '', 'c']);
    expect(cells[1].from).toBe(cells[1].to);
  });
});

describe('findTables', () => {
  it('finds a table and its alignment', () => {
    const [t] = findTables(T);
    expect(t.header.map((c) => c.text)).toEqual(['a', 'b']);
    expect(t.align).toEqual([null, 'right']);
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([['1', '2']]);
    expect(T.slice(t.from, t.to)).toBe(T);
  });

  it('spans only the table when it sits inside a document', () => {
    const src = `# Title\n\n${T}\n\nafter\n`;
    const [t] = findTables(src);
    expect(src.slice(t.from, t.to)).toBe(T);
  });

  it('ends at the next block even without a blank line', () => {
    const src = `${T}\n## next\n`;
    const [t] = findTables(src);
    expect(src.slice(t.from, t.to)).toBe(T);
  });

  it('needs the delimiter row to match the header column count', () => {
    expect(findTables('| a | b |\n| --- |\n| 1 | 2 |')).toEqual([]);
  });

  it('is not fooled by a lone pipe or a setext-looking line', () => {
    expect(findTables('a | b\nnot a delimiter\n')).toEqual([]);
    expect(findTables('title\n---\nbody\n')).toEqual([]);
  });

  it('ignores a table drawn inside fenced code', () => {
    expect(findTables(`\`\`\`\n${T}\n\`\`\`\n`)).toEqual([]);
  });

  it('finds every table in the document', () => {
    const src = `${T}\n\ntext\n\n${T}\n`;
    expect(findTables(src)).toHaveLength(2);
  });

  it('keeps the extra cells of a ragged row rather than dropping them', () => {
    const [t] = findTables('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |');
    expect(t.rows[0].map((c) => c.text)).toEqual(['1', '2', '3']);
  });
});

describe('inlineSegments', () => {
  it('leaves plain text alone', () => {
    expect(inlineSegments('just text')).toEqual([{ text: 'just text', style: 'plain' }]);
  });

  it('styles bold, italic, code, strikethrough and link text', () => {
    expect(inlineSegments('**b** *i* `c` ~~d~~ [t](u)').filter((s) => s.style !== 'plain')).toEqual([
      { text: 'b', style: 'strong' },
      { text: 'i', style: 'em' },
      { text: 'c', style: 'code' },
      { text: 'd', style: 'del' },
      { text: 't', style: 'link' },
    ]);
  });

  it('unescapes a pipe that was escaped to survive the row', () => {
    expect(inlineSegments('a \\| b')).toEqual([{ text: 'a | b', style: 'plain' }]);
  });

  it('reads an image as its alt text plus the source to load', () => {
    expect(inlineSegments('![shot](img/a.png)')).toEqual([
      { text: 'shot', style: 'image', src: 'img/a.png' },
    ]);
  });

  it('does not let an escaped marker open a construct', () => {
    expect(inlineSegments('\\*not italic\\*')).toEqual([{ text: '*not italic*', style: 'plain' }]);
  });

  it('leaves an underscore inside a word alone', () => {
    expect(inlineSegments('col_a_name')).toEqual([{ text: 'col_a_name', style: 'plain' }]);
    expect(inlineSegments('_real_')).toEqual([{ text: 'real', style: 'em' }]);
  });

  it('keeps a code span verbatim', () => {
    expect(inlineSegments('`a * b`')).toEqual([{ text: 'a * b', style: 'code' }]);
  });
});
