/**
 * Objectifs de gain et pertes maximales (§7 du prompt maître).
 *
 * Formule du profit net, explicite :
 *
 *   net = profit réalisé + profit latent - commissions - swaps
 *
 * - `session` : depuis le démarrage de l'exécution du robot ;
 * - `day` : depuis le début de la journée de trading (UTC).
 *
 * Le résultat est une chaîne décimale exacte à 1e-8, jamais un flottant.
 */

import { fromScaled, toScaled } from "./volume";

export type ObjectiveReference = "session" | "day";

export interface NetProfitParts {
  realized: string;
  floating: string;
  commissions: string;
  swaps: string;
}

export function netProfit(parts: NetProfitParts): string {
  // Soustraction signée : une commission déjà négative (crédit) reste valide.
  return fromScaled(
    toScaled(parts.realized) +
      toScaled(parts.floating) -
      toScaled(parts.commissions || "0") -
      toScaled(parts.swaps || "0"),
  );
}

export type ObjectiveTrigger = "profit_target" | "max_loss" | "max_trades" | null;

export interface ObjectiveLimits {
  profitTargetNet: string;
  maxLossNet: string;
  maxTrades: number;
  reference: ObjectiveReference;
}

export interface ObjectiveEvaluation {
  triggered: ObjectiveTrigger;
  net: string;
  reason: string;
}

export const OBJECTIVE_LABELS: Record<ObjectiveReference, string> = {
  session: "Session du robot",
  day: "Journée de trading",
};

/**
 * Évalue l'objectif sur la référence demandée. Une valeur nulle ou négative
 * désactive la limite correspondante (sauf maxTrades, 0 = illimité).
 */
export function evaluateObjective(
  limits: ObjectiveLimits,
  net: string,
  tradesCount: number,
): ObjectiveEvaluation {
  const value = toScaled(net);
  const target = toScaled(limits.profitTargetNet);
  const maxLoss = toScaled(limits.maxLossNet);

  if (limits.maxTrades > 0 && tradesCount >= limits.maxTrades) {
    return {
      triggered: "max_trades",
      net,
      reason: `nombre maximal de trades atteint (${tradesCount}/${limits.maxTrades})`,
    };
  }
  if (target > 0n && value >= target) {
    return {
      triggered: "profit_target",
      net,
      reason: `objectif de gain atteint : ${net} >= ${limits.profitTargetNet}`,
    };
  }
  if (maxLoss > 0n && value <= -maxLoss) {
    return {
      triggered: "max_loss",
      net,
      reason: `perte maximale atteinte : ${net} <= -${limits.maxLossNet}`,
    };
  }
  return { triggered: null, net, reason: "" };
}

/**
 * Le résultat net ne peut jamais être amélioré par une augmentation de volume
 * après une perte : cette fonction n'accepte aucun multiplicateur.
 */
export function netResultPerTrade(realized: string, commissions: string, swaps: string): string {
  return netProfit({ realized, floating: "0", commissions, swaps });
}
