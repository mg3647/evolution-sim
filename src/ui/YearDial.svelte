<script lang="ts">
  import { EVENT_LABELS, type TimedEventKind } from '../sim/environment';

  /** A clock face for the year: the hand shows the season, and arcs outside it show how long events have left. */
  let {
    yearFraction,
    daylight,
    yearLength,
    active,
  }: {
    /** How far through the year it is, from 0 (the start of spring) to 1. */
    yearFraction: number;
    /** 0 at midnight, 1 at noon. */
    daylight: number;
    /** Ticks in a year, to turn an event's remaining ticks into a length of arc. 0 if seasons are off. */
    yearLength: number;
    active: { kind: TimedEventKind; remaining: number }[];
  } = $props();

  const SIZE = 132;
  const C = SIZE / 2;
  const RING = 40;
  /** Seasons in order round the dial. Each is centred on its quarter, so spring straddles the top. */
  const SEASONS = [
    { name: 'Spring', color: '#68b848' },
    { name: 'Summer', color: '#e8c468' },
    { name: 'Autumn', color: '#d9823a' },
    { name: 'Winter', color: '#84a8c8' },
  ];
  const EVENT_COLORS: Record<TimedEventKind, string> = { drought: '#ff8f6b', iceAge: '#9fd8ff', foodBoom: '#7fd6c2' };

  /** A point on a circle, with fraction 0 at the top and going clockwise. */
  function at(fraction: number, radius: number): [number, number] {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;
    return [C + Math.cos(angle) * radius, C + Math.sin(angle) * radius];
  }

  /** An arc of a circle between two fractions of the way round. */
  function arc(from: number, to: number, radius: number): string {
    const length = Math.min(0.9999, to - from);
    const [x0, y0] = at(from, radius);
    const [x1, y1] = at(from + length, radius);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${length > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  const hand = $derived(at(yearFraction, RING + 6));
  const season = $derived(SEASONS[Math.floor(((yearFraction + 0.125) % 1) * 4)]!);
  const events = $derived(
    active.map((event, k) => ({
      ...event,
      color: EVENT_COLORS[event.kind],
      path: arc(yearFraction, yearFraction + (yearLength > 0 ? event.remaining / yearLength : 1), RING + 11 + k * 5),
    })),
  );
</script>

<div class="dial">
  <svg viewBox="0 0 {SIZE} {SIZE}" width={SIZE} height={SIZE} role="img" aria-label="The year: {season.name}">
    {#each SEASONS as s, k (s.name)}
      <path d={arc(k / 4 - 0.125 + 0.004, k / 4 + 0.125 - 0.004, RING)} fill="none" stroke={s.color} stroke-width="7" opacity={s === season ? 1 : 0.35}>
        <title>{s.name}</title>
      </path>
    {/each}
    {#each events as event (event.kind)}
      <path d={event.path} fill="none" stroke={event.color} stroke-width="3" stroke-linecap="round">
        <title>{EVENT_LABELS[event.kind]}: {event.remaining.toLocaleString()} ticks left</title>
      </path>
    {/each}
    <!-- The sky in the middle: bright by day, dark by night. -->
    <circle cx={C} cy={C} r="24" fill="rgb({20 + daylight * 90}, {30 + daylight * 120}, {52 + daylight * 150})" />
    <circle cx={C} cy={C} r="9" fill={daylight >= 0.5 ? '#ffe9a0' : '#c9d3e0'} opacity={0.55 + Math.abs(daylight - 0.5)} />
    <line x1={C} y1={C} x2={hand[0]} y2={hand[1]} stroke="#dfe6ec" stroke-width="1.5" />
    <circle cx={hand[0]} cy={hand[1]} r="3" fill="#dfe6ec" />
  </svg>
  <div class="words">
    <b style="color: {season.color}">{season.name}</b>
    <span>{daylight > 0.7 ? 'Day' : daylight < 0.3 ? 'Night' : 'Twilight'}</span>
    {#each events as event (event.kind)}
      <span class="event" style="border-color: {event.color}">
        {EVENT_LABELS[event.kind]}: {event.remaining.toLocaleString()} ticks left
      </span>
    {/each}
    <small>The hand goes round once a year. Arcs outside the ring are events still running.</small>
  </div>
</div>

<style>
  .dial {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  svg {
    flex-shrink: 0;
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .words b {
    font-size: 15px;
  }

  .event {
    padding-left: 6px;
    border-left: 3px solid;
    color: var(--text);
  }

  small {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.4;
  }
</style>
