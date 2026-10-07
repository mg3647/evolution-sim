import { speciesHue } from '../render/renderer';
import type { HistoryData } from '../worker/protocol';
import type { ChartSeries } from './Chart.svelte';

/** A hex colour for a hue, saturation and lightness in [0, 1]; the charts need hex. */
export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** The colour a species is drawn in everywhere; id 0 stands for the smaller species lumped together. */
export function speciesColor(id: number): string {
  return id === 0 ? '#5a6672' : hslToHex(speciesHue(id), 0.7, 0.6);
}

/** The series of the species stream chart, one per species the history follows. */
export function streamSeries(history: HistoryData | null): ChartSeries[] {
  return (history?.species ?? []).map((s) => ({
    label: s.id === 0 ? 'Smaller species' : `Species ${s.id}`,
    color: speciesColor(s.id),
  }));
}
