import { describe, it, expect } from 'vitest';
import { formatCountLine } from '../src/format.js';

describe('formatCountLine', () => {
  it('returns simple count when no truncation', () => {
    expect(formatCountLine({ count: 5 })).toBe('count: 5');
  });

  it('returns count with total when totalCount is provided', () => {
    expect(formatCountLine({ count: 30, totalCount: 150 })).toBe('count: 30 of 150 total');
  });

  it('returns showing first N when truncated (count equals limit)', () => {
    expect(formatCountLine({ count: 30, limit: 30 })).toBe('count: 30 (showing first 30)');
  });

  it('returns count with total even when truncated if totalCount is known', () => {
    // totalCount takes priority over limit-based truncation message
    expect(formatCountLine({ count: 30, limit: 30, totalCount: 200 })).toBe('count: 30 of 200 total');
  });

  it('returns simple count when count is less than limit', () => {
    expect(formatCountLine({ count: 5, limit: 30 })).toBe('count: 5');
  });

  it('returns count with API limit note for search', () => {
    expect(formatCountLine({ count: 1000, apiLimitHit: true })).toBe('count: 1000+ (GitHub search API limit reached)');
  });

  it('returns showing first N when displayLimit truncates results', () => {
    expect(formatCountLine({ count: 50, displayLimit: 30 })).toBe('count: 50 (showing first 30)');
  });

  it('returns simple count when displayLimit is not exceeded', () => {
    expect(formatCountLine({ count: 20, displayLimit: 30 })).toBe('count: 20');
  });

  it('handles zero count', () => {
    expect(formatCountLine({ count: 0 })).toBe('count: 0');
  });

  it('handles zero count with limit', () => {
    expect(formatCountLine({ count: 0, limit: 30 })).toBe('count: 0');
  });
});
