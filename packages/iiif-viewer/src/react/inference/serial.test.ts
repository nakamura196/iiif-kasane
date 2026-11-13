import { describe, expect, it } from 'vitest';
import { serial } from './serial';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('serial', () => {
  it('starts a task only after the one before it has finished', async () => {
    const queue = serial();
    const log: string[] = [];
    let release!: () => void;
    const first = queue(async () => {
      log.push('a start');
      await new Promise<void>((r) => (release = r));
      log.push('a end');
    });
    const second = queue(async () => {
      log.push('b start');
    });
    await tick();
    expect(log).toEqual(['a start']);
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(['a start', 'a end', 'b start']);
  });

  it('goes on to the next task when one fails, and passes each result to its caller', async () => {
    const queue = serial();
    const failed = queue(async () => {
      throw new Error('boom');
    });
    const next = queue(async () => 42);
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe(42);
  });
});
