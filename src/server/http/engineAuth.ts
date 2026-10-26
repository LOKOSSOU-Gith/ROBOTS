/**
 * Authentification du service moteur (§8.1).
 *
 * Le moteur n'a pas de session utilisateur : chaque appel porte un jeton de
 * service et son identifiant. La comparaison est à temps constant.
 */

import { constantTimeEqual } from "@/server/security/tokens";
import { ApiError } from "./api";

export class EngineAuthError extends ApiError {
  constructor(message = "Service moteur non authentifié") {
    super(401, "engine_unauthorized", message);
  }
}

export function assertEngineRequest(request: Request): { engineId: string } {
  const expected = process.env.ENGINE_AUTH_SECRET ?? "";
  if (expected.length < 16) {
    throw new ApiError(
      503,
      "engine_not_configured",
      "ENGINE_AUTH_SECRET absent ou trop court sur le backend",
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token || !constantTimeEqual(token, expected)) {
    throw new EngineAuthError();
  }

  const engineId = request.headers.get("x-engine-id")?.trim() ?? "";
  if (!engineId || engineId.length > 64) {
    throw new EngineAuthError("Identifiant de moteur absent");
  }
  return { engineId };
}
