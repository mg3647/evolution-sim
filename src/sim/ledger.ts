/**
 * Tracks every unit of energy that enters or leaves the world, so the economy
 * can be checked for conservation: at any time,
 *
 *   energy held in the world = initial + sunIn + seedIn - heatOut
 */
export interface EnergyLedger {
  /** Energy present when the world was created. */
  initial: number;
  /** Cumulative energy added by sunlight (plant growth). */
  sunIn: number;
  /** Cumulative energy added by reseeding creatures into a dying world. */
  seedIn: number;
  /** Cumulative energy dissipated (upkeep, movement, births, deaths). */
  heatOut: number;
}

export function createLedger(): EnergyLedger {
  return { initial: 0, sunIn: 0, seedIn: 0, heatOut: 0 };
}

/** Energy the world should hold according to the ledger. */
export function expectedEnergy(ledger: EnergyLedger): number {
  return ledger.initial + ledger.sunIn + ledger.seedIn - ledger.heatOut;
}
