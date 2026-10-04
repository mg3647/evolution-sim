import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../sim/config';
import { SimRunner } from './runner';

const config = { ...defaultConfig, ticksPerSecond: 30 };
/** A clock that never advances, so the time budget is never hit. */
const frozen = () => 0;

describe('SimRunner', () => {
  it('does nothing while paused', () => {
    const runner = new SimRunner(config);
    expect(runner.advance(1000, frozen, 10)).toBe(0);
    expect(runner.world.tick).toBe(0);
  });

  it('runs ticks in proportion to elapsed time', () => {
    const runner = new SimRunner(config);
    runner.play();
    runner.advance(0, frozen, 10);
    runner.advance(100, frozen, 10);
    expect(runner.world.tick).toBe(3);
    runner.advance(200, frozen, 10);
    expect(runner.world.tick).toBe(6);
  });

  it('scales with the speed multiplier', () => {
    const runner = new SimRunner(config);
    runner.setSpeed(4);
    runner.play();
    runner.advance(0, frozen, 10);
    runner.advance(100, frozen, 10);
    expect(runner.world.tick).toBe(12);
  });

  it('carries fractional ticks between calls', () => {
    const runner = new SimRunner(config);
    runner.play();
    runner.advance(0, frozen, 10);
    for (let t = 10; t <= 1000; t += 10) runner.advance(t, frozen, 10);
    expect(runner.world.tick).toBeGreaterThanOrEqual(29);
    expect(runner.world.tick).toBeLessThanOrEqual(30);
  });

  it('drops the backlog after a long stall instead of catching up', () => {
    const runner = new SimRunner(config);
    runner.play();
    runner.advance(0, frozen, 10);
    runner.advance(60_000, frozen, 10);
    expect(runner.world.tick).toBeLessThanOrEqual(8);
  });

  it('does not count time spent paused', () => {
    const runner = new SimRunner(config);
    runner.play();
    runner.advance(0, frozen, 10);
    runner.pause();
    runner.play();
    runner.advance(5000, frozen, 10);
    expect(runner.world.tick).toBe(0);
  });

  it('runs until the time budget is spent at max speed', () => {
    const runner = new SimRunner(config);
    runner.setSpeed('max');
    runner.play();
    let now = 0;
    const ran = runner.advance(0, () => now++, 10);
    expect(ran).toBeGreaterThan(0);
    expect(runner.world.tick).toBe(ran);
  });

  it('steps an exact number of ticks on request', () => {
    const runner = new SimRunner(config);
    runner.stepTicks(5);
    expect(runner.world.tick).toBe(5);
  });

  it('starts from tick zero after a reset', () => {
    const runner = new SimRunner(config);
    runner.stepTicks(5);
    runner.reset({ ...config, seed: 'other' });
    expect(runner.world.tick).toBe(0);
    expect(runner.world.config.seed).toBe('other');
  });
});
