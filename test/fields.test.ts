import { describe, it, expect } from 'vitest';
import { parseFields } from '../src/fields.js';
import { field, relativeTime, joinArray, pluck, lower, boolYesNo } from '../src/toon.js';
import { AxiError } from '../src/errors.js';

describe('parseFields', () => {
  const available = {
    body: { jsonKey: 'body', def: field('body') },
    closedAt: { jsonKey: 'closedAt', def: relativeTime('closedAt', 'closed_at') },
    labels: { jsonKey: 'labels', def: joinArray('labels', 'name', 'labels') },
    milestone: { jsonKey: 'milestone', def: pluck('milestone', 'title', 'milestone') },
  };

  it('returns empty arrays when fieldsArg is undefined', () => {
    const result = parseFields(undefined, available);
    expect(result.extraDefs).toEqual([]);
    expect(result.extraJsonKeys).toEqual([]);
  });

  it('parses a single field', () => {
    const result = parseFields('body', available);
    expect(result.extraDefs).toEqual([field('body')]);
    expect(result.extraJsonKeys).toEqual(['body']);
  });

  it('parses multiple comma-separated fields', () => {
    const result = parseFields('body,closedAt', available);
    expect(result.extraDefs).toHaveLength(2);
    expect(result.extraJsonKeys).toEqual(['body', 'closedAt']);
  });

  it('trims whitespace around field names', () => {
    const result = parseFields(' body , closedAt ', available);
    expect(result.extraDefs).toHaveLength(2);
    expect(result.extraJsonKeys).toEqual(['body', 'closedAt']);
  });

  it('throws VALIDATION_ERROR for unknown fields', () => {
    try {
      parseFields('body,unknownField', available);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      const err = e as AxiError;
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toContain('unknownField');
      expect(err.message).toContain('body');
      expect(err.message).toContain('closedAt');
      expect(err.message).toContain('labels');
      expect(err.message).toContain('milestone');
    }
  });

  it('throws VALIDATION_ERROR listing all unknown fields', () => {
    try {
      parseFields('bad1,bad2', available);
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as AxiError;
      expect(err.message).toContain('bad1');
      expect(err.message).toContain('bad2');
    }
  });

  it('deduplicates repeated fields', () => {
    const result = parseFields('body,body', available);
    expect(result.extraDefs).toHaveLength(1);
    expect(result.extraJsonKeys).toEqual(['body']);
  });

  it('ignores empty segments from trailing commas', () => {
    const result = parseFields('body,', available);
    expect(result.extraDefs).toHaveLength(1);
    expect(result.extraJsonKeys).toEqual(['body']);
  });
});
