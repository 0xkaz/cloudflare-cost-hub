import { describe, it, expect } from 'vitest';
import { toCsv } from '../../src/server/reports';

describe('toCsv', () => {
  it('renders headers and rows with CRLF line endings', () => {
    const csv = toCsv(['a', 'b'], [[1, 2], [3, 4]]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = toCsv(['name', 'note'], [['a,b', 'say "hi"'], ['c\nd', 'plain']]);
    expect(csv).toBe('name,note\r\n"a,b","say ""hi"""\r\n"c\nd",plain');
  });

  it('escapes embedded quotes by doubling them', () => {
    expect(toCsv(['x'], [['he said "yo"']])).toBe('x\r\n"he said ""yo"""');
  });

  it('handles an empty row set (headers only)', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });
});
