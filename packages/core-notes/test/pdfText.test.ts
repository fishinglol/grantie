import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPageText, type TextItem } from '../src/pdfText.ts';

/** Build a minimal TextItem at a given x/y with a string. */
function item(str: string, x: number, y: number, width = str.length * 5): TextItem {
  return { str, transform: [1, 0, 0, 1, x, y], width };
}

describe('extractPageText', () => {
  it('returns empty when no items', () => {
    const result = extractPageText(1, []);
    assert.equal(result.empty, true);
    assert.deepEqual(result.paragraphs, []);
    assert.equal(result.page, 1);
  });

  it('groups items on the same y into one line / paragraph', () => {
    const items: TextItem[] = [
      item('Hello ', 10, 700),
      item('world', 60, 700),
    ];
    const result = extractPageText(1, items);
    assert.equal(result.empty, false);
    assert.equal(result.paragraphs.length, 1);
    assert.equal(result.paragraphs[0]!.text, 'Hello world');
  });

  it('groups items within tolerance as one line', () => {
    // y values 700 and 701.5 — within 3pt tolerance → same line
    const items: TextItem[] = [
      item('A', 10, 700),
      item('B', 50, 701.5),
    ];
    const result = extractPageText(1, items);
    assert.equal(result.paragraphs.length, 1);
    assert.ok(result.paragraphs[0]!.text.includes('A'));
    assert.ok(result.paragraphs[0]!.text.includes('B'));
  });

  it('separates items far apart in y into different paragraphs', () => {
    // Two lines close together (gap=14), then a big jump (gap=200) → 2 paragraphs.
    const items: TextItem[] = [
      item('First line', 10, 700),
      item('Second line', 10, 686),
      // big gap — 200pt, well above 1.8× the 14pt line step (threshold ≈ 25):
      item('New paragraph', 10, 486),
    ];
    const result = extractPageText(1, items);
    assert.ok(result.paragraphs.length >= 2, `expected ≥2 paragraphs, got ${result.paragraphs.length}`);
    const texts = result.paragraphs.map((p) => p.text);
    assert.ok(texts.some((t) => t.includes('First line') || t.includes('Second line')));
    assert.ok(texts.some((t) => t.includes('New paragraph')));
  });

  it('resolves soft hyphen at line end in a two-column layout', () => {
    // Four lines each 14pt apart → medianDelta=14, threshold=25.2.
    // "con-" at y=700 is followed by "tinue" at y=686 (gap=14 ≤ 14×1.1=15.4) → merge.
    const items: TextItem[] = [
      item('con-', 10, 700),
      item('tinue', 10, 686),
      item('of text', 10, 672),
      item('here.', 10, 658),
    ];
    const result = extractPageText(1, items);
    const text = result.paragraphs.map((p) => p.text).join(' ');
    // The hyphen should be removed and words merged
    assert.ok(text.includes('continue'), `expected "continue" in "${text}"`);
  });

  it('keeps hyphen that is NOT at line-end of a word (like "well-known")', () => {
    // Both parts on the same y → one line, hyphen stays
    const items: TextItem[] = [
      item('well-known', 10, 700),
    ];
    const result = extractPageText(1, items);
    assert.ok(result.paragraphs[0]!.text.includes('well-known'));
  });

  it('filters out items with empty str', () => {
    const items: TextItem[] = [
      item('', 0, 700),
      item('Text', 10, 700),
      item('', 100, 700),
    ];
    const result = extractPageText(1, items);
    assert.equal(result.paragraphs.length, 1);
    assert.equal(result.paragraphs[0]!.text, 'Text');
  });

  it('preserves page number on result', () => {
    const result = extractPageText(7, [item('x', 10, 700)]);
    assert.equal(result.page, 7);
  });

  it('handles a two-column page: items interleaved by y but from different columns', () => {
    // Simulate a two-column layout where both columns have similar y values.
    // Left column: x≈50; right column: x≈300. Same y → grouped into one line per row.
    const items: TextItem[] = [
      item('Left1 ', 50, 700),
      item('Right1', 300, 700),
      item('Left2 ', 50, 686),
      item('Right2', 300, 686),
    ];
    const result = extractPageText(1, items);
    // Both lines should be present in the output
    const text = result.paragraphs.map((p) => p.text).join(' ');
    assert.ok(text.includes('Left1'));
    assert.ok(text.includes('Right1'));
    assert.ok(text.includes('Left2'));
    assert.ok(text.includes('Right2'));
  });
});
