/**
 * Catalogue des quatre robots (§5 du prompt maître).
 *
 * Ces stratégies sont des GABARITS techniques : aucune rentabilité n'est
 * affirmée, et elles ne sont pas validées pour le mode réel. Elles servent à
 * prouver le câblage (données de marché → signal → contrôles de risque →
 * exécution) et à recevoir le code réel de l'utilisateur.
 *
 * Les couples (slug, version) et les schémas ci-dessous doivent correspondre
 * exactement aux manifestes Python de `engine/src/mt5_engine/strategy/`.
 */

import type { ParameterSchema } from "./parameters";

export interface StrategyDefinition {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  version: string;
  versionStatus: "validated" | "active";
  artifactDigest: string;
  supportedSymbols: string[];
  parameterSchema: ParameterSchema;
  riskConstraints: Record<string, unknown>;
  requiresStop: boolean;
  allowsRealMode: false;
}

const SESSION_FILTER: ParameterSchema[string] = {
  type: "enum",
  options: ["asian", "london", "new_york", "any"],
  default: "any",
  label: "Session de trading (UTC)",
};

const LOT_RISK = {
  type: "number" as const,
  min: 0.01,
  max: 1,
  step: 0.01,
  default: 0.25,
  label: "Risque par opération (% de l'équité)",
};

export const STRATEGY_CATALOG: StrategyDefinition[] = [
  {
    slug: "scalp-momentum",
    name: "Robot 1 — Scalping Momentum",
    shortName: "Scalping",
    description:
      "Gabarit de scalping : croisement d'EMA rapide/lente sur les bougies du timeframe choisi. " +
      "Règles non validées, aucune performance garantie.",
    version: "1.0.0",
    versionStatus: "validated",
    artifactDigest: "sha256:scalp-momentum-v1",
    supportedSymbols: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"],
    parameterSchema: {
      lot_risk_pct: LOT_RISK,
      stop_distance_points: {
        type: "integer",
        min: 100,
        max: 2000,
        default: 250,
        label: "Distance du stop (points)",
      },
      fast_ema: { type: "integer", min: 3, max: 50, default: 9, label: "EMA rapide" },
      slow_ema: { type: "integer", min: 10, max: 200, default: 21, label: "EMA lente" },
      session_filter: SESSION_FILTER,
      use_trailing_stop: { type: "boolean", default: false, label: "Stop suiveur" },
    },
    riskConstraints: {
      min_stop_distance_points: 100,
      max_lot_risk_pct: 1,
      requires_stop_loss: true,
      max_concurrent_positions: 2,
    },
    requiresStop: true,
    allowsRealMode: false,
  },
  {
    slug: "trend-following",
    name: "Robot 2 — Suivi de tendance",
    shortName: "Tendance",
    description:
      "Gabarit de suivi de tendance : EMA50/EMA200 et filtre de pente. " +
      "Règles non validées, aucune performance garantie.",
    version: "1.0.0",
    versionStatus: "validated",
    artifactDigest: "sha256:trend-following-v1",
    supportedSymbols: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"],
    parameterSchema: {
      lot_risk_pct: LOT_RISK,
      stop_distance_points: {
        type: "integer",
        min: 300,
        max: 5000,
        default: 600,
        label: "Distance du stop (points)",
      },
      fast_ema: { type: "integer", min: 20, max: 100, default: 50, label: "EMA rapide" },
      slow_ema: { type: "integer", min: 100, max: 400, default: 200, label: "EMA lente" },
      session_filter: SESSION_FILTER,
      use_trailing_stop: { type: "boolean", default: false, label: "Stop suiveur" },
    },
    riskConstraints: {
      min_stop_distance_points: 300,
      max_lot_risk_pct: 1,
      requires_stop_loss: true,
      max_concurrent_positions: 1,
    },
    requiresStop: true,
    allowsRealMode: false,
  },
  {
    slug: "rsi-reversion",
    name: "Robot 3 — RSI",
    shortName: "RSI",
    description:
      "Gabarit de retour à la moyenne : RSI(14) en survente/surachat. " +
      "Règles non validées, aucune performance garantie.",
    version: "1.0.0",
    versionStatus: "validated",
    artifactDigest: "sha256:rsi-reversion-v1",
    supportedSymbols: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"],
    parameterSchema: {
      lot_risk_pct: LOT_RISK,
      stop_distance_points: {
        type: "integer",
        min: 100,
        max: 2000,
        default: 300,
        label: "Distance du stop (points)",
      },
      rsi_period: { type: "integer", min: 5, max: 50, default: 14, label: "Période RSI" },
      rsi_buy: { type: "integer", min: 10, max: 45, default: 30, label: "Seuil d'achat" },
      rsi_sell: { type: "integer", min: 55, max: 90, default: 70, label: "Seuil de vente" },
      session_filter: SESSION_FILTER,
    },
    riskConstraints: {
      min_stop_distance_points: 100,
      max_lot_risk_pct: 1,
      requires_stop_loss: true,
      max_concurrent_positions: 1,
    },
    requiresStop: true,
    allowsRealMode: false,
  },
  {
    slug: "breakout-custom",
    name: "Robot 4 — Stratégie personnalisée",
    shortName: "Personnalisée",
    description:
      "Gabarit de cassure : plus haut/plus bas des N dernières bougies. " +
      "Emplacement prévu pour vos propres règles, non validé pour le réel.",
    version: "1.0.0",
    versionStatus: "validated",
    artifactDigest: "sha256:breakout-custom-v1",
    supportedSymbols: ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"],
    parameterSchema: {
      lot_risk_pct: LOT_RISK,
      stop_distance_points: {
        type: "integer",
        min: 100,
        max: 3000,
        default: 400,
        label: "Distance du stop (points)",
      },
      lookback_bars: {
        type: "integer",
        min: 10,
        max: 200,
        default: 24,
        label: "Bougies de la cassure",
      },
      session_filter: SESSION_FILTER,
      use_trailing_stop: { type: "boolean", default: false, label: "Stop suiveur" },
    },
    riskConstraints: {
      min_stop_distance_points: 100,
      max_lot_risk_pct: 1,
      requires_stop_loss: true,
      max_concurrent_positions: 1,
    },
    requiresStop: true,
    allowsRealMode: false,
  },
];

export function strategyBySlug(slug: string): StrategyDefinition | undefined {
  return STRATEGY_CATALOG.find((strategy) => strategy.slug === slug);
}

export function defaultParametersFor(strategy: StrategyDefinition): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(strategy.parameterSchema).map(([key, field]) => [key, field.default]),
  );
}
