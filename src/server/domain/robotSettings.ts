/**
 * Paramètres éditables d'un robot, validés côté serveur (§5, §8).
 *
 * Le frontend valide aussi, mais cette validation est la seule qui fasse foi :
 * une requête forgée ne peut pas enregistrer un lot hors bornes ou une
 * politique d'arrêt inconnue.
 */

import { z } from "zod";

import { toScaled } from "./volume";

export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const;

const decimal = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,8})?$/, `${label} : nombre décimal positif attendu (8 décimales maximum)`);

export const allowedHoursSchema = z
  .object({
    start: z.number().int().min(0).max(23),
    end: z.number().int().min(1).max(24),
  })
  .refine((value) => value.start < value.end, {
    message: "La plage horaire doit commencer avant de finir",
  });

export const robotSettingsSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9._#-]+$/, "Symbole invalide"),
    timeframe: z.enum(TIMEFRAMES),
    initialLot: decimal("Lot initial"),
    profitTargetNet: decimal("Objectif de gain"),
    maxLossNet: decimal("Perte maximale"),
    profitReference: z.enum(["session", "day"]),
    maxTrades: z.number().int().min(1).max(1000),
    maxPositions: z.number().int().min(1).max(20),
    maxSpreadPoints: z.number().int().min(0).max(10_000),
    allowedHours: allowedHoursSchema,
    stopPolicy: z.enum(["keep_positions", "close_positions"]),
    strategyParameters: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (toScaled(value.initialLot) <= 0n) {
      ctx.addIssue({ code: "custom", path: ["initialLot"], message: "Le lot doit être positif" });
    }
    if (toScaled(value.initialLot) > toScaled("100")) {
      ctx.addIssue({
        code: "custom",
        path: ["initialLot"],
        message: "Le lot ne peut pas dépasser 100",
      });
    }
    if (toScaled(value.profitTargetNet) === 0n) {
      ctx.addIssue({
        code: "custom",
        path: ["profitTargetNet"],
        message: "L'objectif de gain doit être supérieur à zéro",
      });
    }
    if (toScaled(value.maxLossNet) === 0n) {
      ctx.addIssue({
        code: "custom",
        path: ["maxLossNet"],
        message: "La perte maximale doit être supérieure à zéro",
      });
    }
  });

export type RobotSettingsInput = z.infer<typeof robotSettingsSchema>;

export const createAccountSchema = z.object({
  broker: z.string().trim().min(2).max(120),
  server: z.string().trim().min(2).max(120),
  login: z.string().trim().regex(/^\d{4,16}$/, "Numéro de compte invalide"),
  password: z.string().min(1).max(256),
  environment: z.enum(["demo", "real"]).default("demo"),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const emergencyStopSchema = z.object({
  confirmation: z.literal("ARRÊT D'URGENCE"),
});
