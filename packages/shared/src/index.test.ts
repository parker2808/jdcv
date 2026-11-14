import { describe, expect, it } from 'vitest';
import { formatStudyPackTitle } from './index.js';

describe('formatStudyPackTitle', () => {
  it('trims the job title', () => {
    expect(formatStudyPackTitle('  Frontend engineer  ')).toBe(
      'Study pack for Frontend engineer',
    );
  });
});
