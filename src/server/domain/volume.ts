/**
 * Arithmétique des volumes, miroir exact de `engine/src/mt5_engine/volume.py`.
 *
 * Tous les calculs se font en entiers à l'échelle 1e8 : aucun arrondi binaire
 * ne peut produire un lot légèrement supérieur à la limite (§13 T1).
 */

export const SCALE = 100_000_000n;

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export class NumberFormatError extends Error {}

export type Numeric = string | number;

export function toScaled(value: Numeric): bigint {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!NUMBER_RE.test(raw)) {
    throw new NumberFormatError(`valeur numérique invalide: ${raw}`);
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = (fraction + "00000000").slice(0, 8);
  const scaled = BigInt(whole || "0") * SCALE + BigInt(padded || "0");
  return negative ? -scaled : scaled;
}

export function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  const result = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${result}` : result;
}

export function floorToStep(scaled: bigint, stepScaled: bigint): bigint {
  if (stepScaled <= 0n) throw new Error("pas de lot invalide");
  return (scaled / stepScaled) * stepScaled;
}

export interface LotConstraints {
  minLot: string;
  maxLot: string;
  lotStep: string;
}

export type LotRejection = "none" | "below_min" | "non_positive" | "risk_ceiling";

export interface LotResolution {
  volume: string | null;
  clampedToMax: boolean;
  rejectedReason: LotRejection;
}

export function resolveLot(requested: string, constraints: LotConstraints): LotResolution {
  const minimum = toScaled(constraints.minLot);
  const maximum = toScaled(constraints.maxLot);
  const step = toScaled(constraints.lotStep);

  let value = toScaled(requested);
  if (value <= 0n) {
    return { volume: null, clampedToMax: false, rejectedReason: "non_positive" };
  }

  value = floorToStep(value, step);
  if (value < minimum) {
    return { volume: null, clampedToMax: false, rejectedReason: "below_min" };
  }

  const clampedToMax = value > maximum;
  if (clampedToMax) {
    value = floorToStep(maximum, step);
  }
  if (value < minimum) {
    return { volume: null, clampedToMax, rejectedReason: "below_min" };
  }

  return { volume: fromScaled(value), clampedToMax, rejectedReason: "none" };
}

export interface VolumeInputs {
  equity: string;
  riskPerTradePct: string;
  stopDistancePoints: number;
  pointValuePerLot: string;
  lot: LotConstraints;
}

/**
 * Volume de référence : équité courante × risque % / (stop en points × valeur
 * du point). Aucun champ d'historique de pertes n'entre dans la formule, ce qui
 * exclut structurellement le Martingale (§6.1).
 */
export function computeBaseVolume(inputs: VolumeInputs): LotResolution {
  if (inputs.stopDistancePoints <= 0) {
    return { volume: null, clampedToMax: false, rejectedReason: "risk_ceiling" };
  }

  const equity = toScaled(inputs.equity);
  if (equity <= 0n) {
    return { volume: null, clampedToMax: false, rejectedReason: "non_positive" };
  }

  const riskPct = toScaled(inputs.riskPerTradePct);
  if (riskPct < 0n || riskPct > toScaled("100")) {
    return { volume: null, clampedToMax: false, rejectedReason: "risk_ceiling" };
  }

  const cashRisk = (equity * riskPct) / toScaled("100");
  const pointValue = toScaled(inputs.pointValuePerLot);
  if (pointValue <= 0n) {
    return { volume: null, clampedToMax: false, rejectedReason: "risk_ceiling" };
  }

  const denominator = pointValue * BigInt(inputs.stopDistancePoints);
  if (denominator === 0n) {
    return { volume: null, clampedToMax: false, rejectedReason: "risk_ceiling" };
  }

  const rawVolume = (cashRisk * SCALE) / denominator;
  return resolveLot(fromScaled(rawVolume), inputs.lot);
}

/** Compare deux valeurs décimales sans passer par un flottant. */
export function compareNumeric(left: string, right: string): -1 | 0 | 1 {
  const a = toScaled(left);
  const b = toScaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Addition de montants décimaux, exacte à 1e-8. */
export function sumNumeric(values: readonly string[]): string {
  return fromScaled(values.reduce((total, value) => total + toScaled(value), 0n));
}
