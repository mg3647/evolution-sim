import { describe, expect, it } from 'vitest';
import { createHistory, recordSample, type Sample } from './stats';

function sample(tick: number): Sample {
  return { tick, population: tick * 2, plantFill: 0.5, meanSize: 1, meanSpeed: 1, meanSensorRange: 1, meanLinks: 4, meanNeurons: 0 };
}

describe('history', () => {
  it('records samples in order', () => {
    const history = createHistory(10, 8);
    for (let t = 0; t < 30; t += 10) recordSample(history, sample(t));
    expect(history.count).toBe(3);
    expect(Array.from(history.tick.subarray(0, 3))).toEqual([0, 10, 20]);
    expect(Array.from(history.population.subarray(0, 3))).toEqual([0, 20, 40]);
    expect(history.version).toBe(3);
  });

  it('halves its resolution when full, keeping the whole time span', () => {
    const history = createHistory(10, 4);
    for (let t = 0; t <= 40; t += 10) recordSample(history, sample(t));
    expect(history.interval).toBe(20);
    expect(history.count).toBe(3);
    expect(Array.from(history.tick.subarray(0, 3))).toEqual([0, 20, 40]);
    expect(Array.from(history.population.subarray(0, 3))).toEqual([0, 40, 80]);
  });

  it('never exceeds its capacity over a long run', () => {
    const history = createHistory(1, 16);
    let tick = 0;
    for (let i = 0; i < 5000; i++) {
      if (tick % history.interval === 0) recordSample(history, sample(tick));
      tick++;
    }
    expect(history.count).toBeLessThanOrEqual(16);
    expect(history.tick[0]).toBe(0);
    for (let i = 1; i < history.count; i++) {
      expect(history.tick[i]!).toBeGreaterThan(history.tick[i - 1]!);
    }
  });
});
