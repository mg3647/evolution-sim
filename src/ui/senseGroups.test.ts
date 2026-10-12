import { describe, expect, it } from 'vitest';
import { Input, INPUT_LABELS, INPUTS_PER_RAY, Ray } from '../sim/brain';
import { senseNow, senseSides } from './senseGroups';

const AHEAD = 1;

describe('two-way senses', () => {
  it('names the side that is active', () => {
    const items = AHEAD * INPUTS_PER_RAY + Ray.Items;
    expect(INPUT_LABELS[items]).toBe('Stone or branch ahead');
    expect(senseNow(items, 0.5, INPUT_LABELS[items]!)).toBe('Stone ahead');
    expect(senseNow(items, -0.5, INPUT_LABELS[items]!)).toBe('Branch ahead');
    expect(senseNow(Input.BehindSide, -0.9, INPUT_LABELS[Input.BehindSide]!)).toBe('Creature behind on the left');
  });

  it('leaves one-way senses as they are', () => {
    const plants = AHEAD * INPUTS_PER_RAY + Ray.Plants;
    expect(senseSides(plants)).toBeNull();
    expect(senseNow(plants, 0.7, INPUT_LABELS[plants]!)).toBe('Plants ahead');
  });
});
