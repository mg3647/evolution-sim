import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { buildReport, configKey, reportFileName } from './report';
import { createWorld, step } from './world';

const smallConfig: SimConfig = {
  ...defaultConfig,
  worldWidth: 800,
  worldHeight: 800,
  initialCreatures: 80,
  statsInterval: 20,
};
const meta = { appVersion: 'test', createdAt: '2026-10-11T15:00:00.000Z', question: 'why', notes: 'because' };

function runWorld(ticks: number) {
  const world = createWorld(smallConfig);
  for (let i = 0; i < ticks; i++) step(world);
  return world;
}

describe('run report', () => {
  it('holds the run, the series and the final state, and survives JSON', () => {
    const world = runWorld(1500);
    const report = buildReport(world, [], meta);
    const copy = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(copy.run.seed).toBe(smallConfig.seed);
    expect(copy.run.tick).toBe(1500);
    expect(copy.question).toBe('why');
    expect(copy.series.names[0]).toBe('tick');
    expect(copy.series.data).toHaveLength(copy.series.names.length);
    for (const column of copy.series.data) expect(column).toHaveLength(copy.series.points);
    expect(copy.series.points).toBeGreaterThan(10);
    expect(copy.final.traits.size!.p50).toBeGreaterThan(0);
    expect(copy.headline.ticks).toBe(1500);
  });

  it('thins long histories but keeps the last sample', () => {
    const world = runWorld(1);
    const { history } = world;
    history.count = Math.min(history.tick.length, 900);
    for (let k = 0; k < history.count; k++) history.tick[k] = k * history.interval;
    const report = buildReport(world, [], meta);
    expect(report.series.points).toBe(200);
    expect(report.series.data[0]!.at(-1)).toBe((history.count - 1) * history.interval);
  });

  it('is clean only when nothing was done by hand and nothing was reseeded', () => {
    const world = runWorld(10);
    expect(buildReport(world, [], meta).clean).toBe(true);
    const touched = buildReport(world, [{ tick: 5, kind: 'tool', detail: 'meteor', count: 3 }], meta);
    expect(touched.clean).toBe(false);
    expect(touched.interventions.byKind.tool).toBe(3);
    world.reseeded = 4;
    expect(buildReport(world, [], meta).clean).toBe(false);
  });

  it('reports only settings that differ from the defaults', () => {
    const report = buildReport(runWorld(1), [], meta);
    expect(report.run.changedSettings.initialCreatures).toBe(80);
    expect(report.run.changedSettings.thirstRate).toBeUndefined();
  });

  it('gives repeats of the same settings one key whatever the seed', () => {
    expect(configKey({ ...smallConfig, seed: 'a' })).toBe(configKey({ ...smallConfig, seed: 'b' }));
    expect(configKey(smallConfig)).not.toBe(configKey({ ...smallConfig, thirstRate: 0.5 }));
  });

  it('makes a file name that is safe in a path', () => {
    const report = buildReport(runWorld(1), [], meta);
    report.run.seed = 'my seed/../x';
    expect(reportFileName(report)).toMatch(/^2026-10-11_15-00-00_my_seed_x_tick1\.json$/);
  });
});
