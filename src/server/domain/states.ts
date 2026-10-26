/**
 * États d'instance (§7.2) et transitions autorisées.
 *
 * Table identique à `engine/src/mt5_engine/states.py`. Un état RUNNING n'est
 * affiché que si le moteur l'a confirmé récemment (§14).
 */

export const INSTANCE_STATES = [
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "ERROR",
  "RISK_HALTED",
  "DISCONNECTED",
] as const;

export type InstanceState = (typeof INSTANCE_STATES)[number];

export const ALLOWED_TRANSITIONS: Record<InstanceState, readonly InstanceState[]> = {
  STOPPED: ["STARTING"],
  STARTING: ["RUNNING", "ERROR", "STOPPING", "DISCONNECTED"],
  RUNNING: ["STOPPING", "ERROR", "RISK_HALTED", "DISCONNECTED"],
  STOPPING: ["STOPPED", "ERROR"],
  ERROR: ["STARTING", "STOPPING", "STOPPED"],
  RISK_HALTED: ["STOPPING", "STOPPED", "STARTING"],
  DISCONNECTED: ["STARTING", "STOPPING", "STOPPED", "ERROR"],
};

export function transitionAllowed(current: InstanceState, target: InstanceState): boolean {
  return ALLOWED_TRANSITIONS[current].includes(target);
}

export function parseState(value: string): InstanceState {
  if (!(INSTANCE_STATES as readonly string[]).includes(value)) {
    throw new Error(`état inconnu: ${value}`);
  }
  return value as InstanceState;
}

export const LIVE_STATES: readonly InstanceState[] = ["STARTING", "RUNNING", "STOPPING"];

export function isLive(state: InstanceState): boolean {
  return LIVE_STATES.includes(state);
}

/** Cible d'un démarrage : seuls ces états acceptent une nouvelle exécution. */
export function canStart(state: InstanceState): boolean {
  return ["STOPPED", "ERROR", "RISK_HALTED", "DISCONNECTED"].includes(state);
}

export const STATE_LABELS: Record<InstanceState, string> = {
  STOPPED: "Arrêté",
  STARTING: "Démarrage",
  RUNNING: "En cours",
  STOPPING: "Arrêt en cours",
  ERROR: "Erreur",
  RISK_HALTED: "Bloqué par le risque",
  DISCONNECTED: "Déconnecté",
};

export const STATE_TONES: Record<
  InstanceState,
  "neutral" | "success" | "warning" | "danger" | "info"
> = {
  STOPPED: "neutral",
  STARTING: "info",
  RUNNING: "success",
  STOPPING: "warning",
  ERROR: "danger",
  RISK_HALTED: "danger",
  DISCONNECTED: "warning",
};

/** Silence du moteur au-delà duquel un état RUNNING ne peut plus être affiché. */
export const ENGINE_SILENCE_MS = 45_000;

export function effectiveState(
  state: InstanceState,
  lastEngineSeenAt: Date | null,
  now: Date = new Date(),
): InstanceState {
  if (state !== "RUNNING" && state !== "STOPPING" && state !== "STARTING") return state;
  if (!lastEngineSeenAt) return "DISCONNECTED";
  return now.getTime() - lastEngineSeenAt.getTime() > ENGINE_SILENCE_MS
    ? "DISCONNECTED"
    : state;
}
