/**
 * Règles métier — volumes, objectifs, paramètres, états, formulaire robot.
 *
 * Les calculs sont volontairement testés sur des valeurs pièges (0.1 + 0.2,
 * bornes de pas de lot) pour prouver qu'aucun flottant n'intervient.
 */

import { describe, expect, it } from "vitest";

import { evaluateObjective, netProfit, type ObjectiveLimits } from "@/server/domain/objectives";
import {
  canonicalJson,
  parametersDigest,
  validateParameters,
  type ParameterSchema,
} from "@/server/domain/parameters";
import { robotSettingsSchema, createAccountSchema } from "@/server/domain/robotSettings";
import { canStart, effectiveState, transitionAllowed } from "@/server/domain/states";
import {
  compareNumeric,
  computeBaseVolume,
  fromScaled,
  resolveLot,
  sumNumeric,
  toScaled,
} from "@/server/domain/volume";

const limits: ObjectiveLimits = {
  profitTargetNet: "10",
  maxLossNet: "5",
  maxTrades: 20,
  reference: "session",
};

describe("arithmétique décimale exacte", () => {
  it("additionne sans erreur binaire", () => {
    expect(sumNumeric(["0.1", "0.2"])).toBe("0.3");
    expect(sumNumeric(["1.00000001", "-0.00000001"])).toBe("1");
    expect(fromScaled(toScaled("123.456"))).toBe("123.456");
    expect(compareNumeric("10.00000001", "10")).toBe(1);
    expect(compareNumeric("-1", "0")).toBe(-1);
  });

  it("refuse les formats non décimaux", () => {
    expect(() => toScaled("1e3")).toThrow();
    expect(() => toScaled("abc")).toThrow();
    expect(() => toScaled("1,5")).toThrow();
  });

  it("arrondit toujours vers le bas au pas du broker, jamais au-dessus", () => {
    const lot = { minLot: "0.01", maxLot: "0.10", lotStep: "0.01" };
    expect(resolveLot("0.019", lot).volume).toBe("0.01");
    expect(resolveLot("0.10", lot).volume).toBe("0.1");
    expect(resolveLot("0.001", lot).rejectedReason).toBe("below_min");
    expect(resolveLot("0", lot).rejectedReason).toBe("non_positive");
    expect(resolveLot("-1", lot).rejectedReason).toBe("non_positive");
    const clamped = resolveLot("5", lot);
    expect(clamped.volume).toBe("0.1");
    expect(clamped.clampedToMax).toBe(true);
  });

  it("calcule le volume de risque sans aucun multiplicateur de perte", () => {
    const base = {
      equity: "10000",
      riskPerTradePct: "0.25",
      stopDistancePoints: 250,
      pointValuePerLot: "1",
      lot: { minLot: "0.01", maxLot: "10", lotStep: "0.01" },
    };
    // 10000 × 0,25 % / (250 × 1) = 0,10 lot exactement.
    expect(computeBaseVolume(base).volume).toBe("0.1");
    // Le doublement de l'équité ne dépend jamais d'une perte précédente : la
    // fonction ne reçoit aucun historique, seulement l'équité courante.
    expect(computeBaseVolume({ ...base, equity: "20000" }).volume).toBe("0.2");
    expect(
      computeBaseVolume({ ...base, stopDistancePoints: 0 }).rejectedReason,
    ).toBe("risk_ceiling");
  });
});

describe("objectifs de gain et pertes", () => {
  it("calcule le résultat net commissions et swaps déduits", () => {
    // 12 - 1 - 0,5 - (-0,2) = 10,7 : un swap négatif est un crédit.
    expect(netProfit({ realized: "12", floating: "-1", commissions: "0.5", swaps: "-0.2" })).toBe(
      "10.7",
    );
    expect(netProfit({ realized: "0", floating: "0", commissions: "-0.1", swaps: "0" })).toBe(
      "0.1",
    );
  });

  it("déclenche l'objectif de gain à la borne exacte", () => {
    expect(evaluateObjective(limits, "9.99", 1).triggered).toBeNull();
    const reached = evaluateObjective(limits, "10", 1);
    expect(reached.triggered).toBe("profit_target");
    expect(reached.reason).toContain("10");
  });

  it("déclenche la perte maximale à la borne exacte", () => {
    expect(evaluateObjective(limits, "-4.99", 1).triggered).toBeNull();
    expect(evaluateObjective(limits, "-5", 1).triggered).toBe("max_loss");
  });

  it("le quota de trades prime et zéro désactive les limites monétaires", () => {
    expect(evaluateObjective(limits, "100", 20).triggered).toBe("max_trades");
    const disabled = evaluateObjective(
      { ...limits, profitTargetNet: "0", maxLossNet: "0" },
      "-1000",
      0,
    );
    expect(disabled.triggered).toBeNull();
  });
});

describe("paramètres de stratégie", () => {
  const schema: ParameterSchema = {
    fast_ema: { type: "integer", min: 3, max: 50, default: 9 },
    lot_risk_pct: { type: "number", min: 0.01, max: 1, step: 0.01, default: 0.25 },
    use_trailing_stop: { type: "boolean", default: false },
    session_filter: {
      type: "enum",
      options: ["asian", "london", "new_york", "any"],
      default: "any",
    },
  };

  it("applique les valeurs par défaut et accepte une configuration valide", () => {
    const result = validateParameters(schema, { fast_ema: 12 });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({
      fast_ema: 12,
      lot_risk_pct: 0.25,
      use_trailing_stop: false,
      session_filter: "any",
    });
  });

  it("refuse type, borne, pas et clé inconnue", () => {
    expect(validateParameters(schema, { fast_ema: 2 }).issues[0]?.code).toBe("out_of_range");
    expect(validateParameters(schema, { fast_ema: 4.5 }).issues[0]?.code).toBe("wrong_type");
    expect(validateParameters(schema, { lot_risk_pct: 0.255 }).issues[0]?.code).toBe("bad_step");
    expect(validateParameters(schema, { session_filter: "paris" }).issues[0]?.code).toBe(
      "not_in_options",
    );
    expect(validateParameters(schema, { inconnu: true }).issues[0]?.code).toBe("unknown_key");
    expect(validateParameters(schema, "texte").ok).toBe(false);
  });

  it("produit le même condensé que le moteur Python", () => {
    const values = {
      fast_ema: 9,
      slow_ema: 21,
      use_trailing_stop: false,
      session_filter: "any",
    };
    expect(canonicalJson(values)).toBe(
      '{"fast_ema":9,"session_filter":"any","slow_ema":21,"use_trailing_stop":false}',
    );
    expect(parametersDigest(values)).toBe("13562567e44f9909");
  });
});

describe("états d'instance", () => {
  it("n'autorise que les transitions prévues", () => {
    expect(transitionAllowed("STOPPED", "STARTING")).toBe(true);
    expect(transitionAllowed("STOPPED", "RUNNING")).toBe(false);
    expect(canStart("STOPPED")).toBe(true);
    expect(canStart("RUNNING")).toBe(false);
  });

  it("ne montre jamais RUNNING sans moteur récent", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(effectiveState("RUNNING", null, now)).toBe("DISCONNECTED");
    expect(effectiveState("RUNNING", new Date(now.getTime() - 10_000), now)).toBe("RUNNING");
    expect(effectiveState("RUNNING", new Date(now.getTime() - 46_000), now)).toBe("DISCONNECTED");
    expect(effectiveState("STOPPED", null, now)).toBe("STOPPED");
  });
});

describe("formulaires", () => {
  const settings = {
    symbol: "XAUUSD",
    timeframe: "M15",
    initialLot: "0.01",
    profitTargetNet: "10",
    maxLossNet: "5",
    profitReference: "session",
    maxTrades: 20,
    maxPositions: 1,
    maxSpreadPoints: 50,
    allowedHours: { start: 0, end: 24 },
    stopPolicy: "keep_positions",
    strategyParameters: {},
  };

  it("accepte une configuration conforme", () => {
    expect(robotSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it("refuse lot nul, objectif nul, horaires inversés et symbole injecté", () => {
    expect(robotSettingsSchema.safeParse({ ...settings, initialLot: "0" }).success).toBe(false);
    expect(robotSettingsSchema.safeParse({ ...settings, profitTargetNet: "0" }).success).toBe(false);
    expect(robotSettingsSchema.safeParse({ ...settings, maxLossNet: "0" }).success).toBe(false);
    expect(
      robotSettingsSchema.safeParse({ ...settings, allowedHours: { start: 20, end: 8 } }).success,
    ).toBe(false);
    expect(robotSettingsSchema.safeParse({ ...settings, symbol: "XAU/USD" }).success).toBe(false);
    expect(robotSettingsSchema.safeParse({ ...settings, timeframe: "H2" }).success).toBe(false);
  });

  it("refuse un numéro de compte non numérique", () => {
    const account = {
      broker: "Broker",
      server: "Broker-Demo",
      login: "12345678",
      password: "secret",
      environment: "demo",
    };
    expect(createAccountSchema.safeParse(account).success).toBe(true);
    expect(createAccountSchema.safeParse({ ...account, login: "12ab" }).success).toBe(false);
    expect(createAccountSchema.safeParse({ ...account, environment: "live" }).success).toBe(false);
  });
});
