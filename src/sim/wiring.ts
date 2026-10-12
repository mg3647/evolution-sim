import type { Creatures } from './creatures';

/**
 * Evolutionary activity statistics (Bedau and Packard), counted on brain
 * links. A link is a "component" identified by its innovation id. Each time
 * the world is sampled, every link that at least one creature carries gains
 * one unit of activity, so a link that stays in the population for a long
 * time has high activity.
 *
 * High activity alone does not show selection: in a finite population some
 * links last by drift. So a neutral shadow runs beside the real population.
 * Every creature carries, besides its real brain, a shadow list of link ids
 * with the same births and deaths, but a newborn's shadow copies a random
 * living creature's old enough to breed instead of its parent's, plus whatever
 * links its real brain gained. The shadow has no way to be favoured, so how long its links
 * last is what drift alone produces. Real links that last longer than shadow
 * links of the same age are evidence that selection keeps them; shorter, that
 * selection purges new wiring.
 */
export interface WiringTally {
  /** Activity of every link id ever carried, in the real population and in the shadow. */
  real: Map<number, number>;
  shadow: Map<number, number>;
  /** The tick of the sample at which each link id was first carried. */
  realFirst: Map<number, number>;
  shadowFirst: Map<number, number>;
  /** Samples taken so far. */
  samples: number;
  /** The tick of the first sample; links carried then are the founders', not new. */
  startTick: number;
}

export function createWiringTally(): WiringTally {
  return { real: new Map(), shadow: new Map(), realFirst: new Map(), shadowFirst: new Map(), samples: 0, startTick: 0 };
}

/**
 * Count the links of a creature brought in from outside (a reseeded founder)
 * as present from the start, really and in the shadow, so they are not judged
 * as new wiring: they were not made by mutation, and naive founders mostly die.
 * Links already seen keep when they were first carried.
 */
export function markFounding(tally: WiringTally, brain: { links: readonly { innovation: number }[] }): void {
  for (const link of brain.links) {
    if (!tally.realFirst.has(link.innovation)) tally.realFirst.set(link.innovation, tally.startTick);
    if (!tally.shadowFirst.has(link.innovation)) tally.shadowFirst.set(link.innovation, tally.startTick);
  }
}

export interface WiringStats {
  /** Different links carried right now, really and in the shadow. */
  live: number;
  shadowLive: number;
  /** Mean activity of the links carried right now. */
  meanActivity: number;
  shadowMeanActivity: number;
  /**
   * Of the links that first appeared at least `survivalTicks` ago, the
   * share still carried now, really and in the shadow. Equal ages, so the two
   * are comparable. Above the shadow means selection keeps new wiring that
   * drift alone would lose; below means selection purges it.
   */
  survival: number;
  shadowSurvival: number;
}

/**
 * Count one sample of activity, taken at `tick`, and report where the real
 * population stands against the shadow. A link counts as new if it first
 * appeared after the first sample, and its lasting is judged once it is at
 * least `survivalTicks` old. The window is in ticks, not samples, because
 * samples grow further apart as a run goes on.
 */
export function sampleWiring(tally: WiringTally, c: Creatures, tick: number, survivalTicks: number): WiringStats {
  const real = new Set<number>();
  const shadow = new Set<number>();
  for (let i = 0; i < c.count; i++) {
    for (const link of c.brain[i]!.links) real.add(link.innovation);
    for (const id of c.shadow[i]!) shadow.add(id);
  }
  if (tally.samples++ === 0) tally.startTick = tick;
  const advance = (present: Set<number>, activity: Map<number, number>, first: Map<number, number>) => {
    let total = 0;
    for (const id of present) {
      const now = (activity.get(id) ?? 0) + 1;
      activity.set(id, now);
      total += now;
      if (!first.has(id)) first.set(id, tick);
    }
    let old = 0;
    let kept = 0;
    for (const [id, at] of first) {
      if (at > tally.startTick && tick - at >= survivalTicks) {
        old++;
        if (present.has(id)) kept++;
      }
    }
    return { mean: present.size > 0 ? total / present.size : 0, survival: old > 0 ? kept / old : 0 };
  };
  const r = advance(real, tally.real, tally.realFirst);
  const s = advance(shadow, tally.shadow, tally.shadowFirst);
  return {
    live: real.size,
    shadowLive: shadow.size,
    meanActivity: r.mean,
    shadowMeanActivity: s.mean,
    survival: r.survival,
    shadowSurvival: s.survival,
  };
}
