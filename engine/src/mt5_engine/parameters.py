"""Re-vérification des paramètres de stratégie dans le moteur (§8.1).

Miroir de `src/server/domain/parameters.ts` : les limites publiées à
l'utilisateur sont exactement celles refusées ici, y compris si la base de
données a été modifiée hors du parcours normal.
"""

from __future__ import annotations

from dataclasses import dataclass

UNKNOWN_KEY = "unknown_key"
OUT_OF_RANGE = "out_of_range"
WRONG_TYPE = "wrong_type"
NOT_IN_OPTIONS = "not_in_options"
BAD_STEP = "bad_step"


@dataclass(frozen=True)
class ValidationIssue:
    key: str
    code: str
    limit: float | int | None = None


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    issues: tuple[ValidationIssue, ...]
    values: dict


def validate_parameters(schema: dict, incoming: dict | None) -> ValidationResult:
    issues: list[ValidationIssue] = []
    values: dict = {}
    provided_map = incoming or {}

    if not isinstance(provided_map, dict):
        return ValidationResult(False, (ValidationIssue("_", WRONG_TYPE),), {})

    for key, field in schema.items():
        if key not in provided_map:
            values[key] = field.get("default")
            continue
        provided = provided_map[key]
        kind = field.get("type")

        if kind == "number":
            if isinstance(provided, bool) or not isinstance(provided, (int, float)):
                issues.append(ValidationIssue(key, WRONG_TYPE))
                continue
            minimum, maximum = float(field["min"]), float(field["max"])
            if provided < minimum or provided > maximum:
                issues.append(
                    ValidationIssue(key, OUT_OF_RANGE, minimum if provided < minimum else maximum)
                )
                continue
            step = field.get("step")
            if step:
                steps = provided / float(step)
                if abs(steps - round(steps)) > 1e-9:
                    issues.append(ValidationIssue(key, BAD_STEP, float(step)))
                    continue
            values[key] = provided

        elif kind == "integer":
            if isinstance(provided, bool) or not isinstance(provided, int):
                issues.append(ValidationIssue(key, WRONG_TYPE))
                continue
            minimum, maximum = int(field["min"]), int(field["max"])
            if provided < minimum or provided > maximum:
                issues.append(ValidationIssue(key, OUT_OF_RANGE, minimum if provided < minimum else maximum))
                continue
            values[key] = provided

        elif kind == "boolean":
            if not isinstance(provided, bool):
                issues.append(ValidationIssue(key, WRONG_TYPE))
                continue
            values[key] = provided

        elif kind == "enum":
            options = list(field.get("options") or [])
            if not isinstance(provided, str) or provided not in options:
                issues.append(ValidationIssue(key, NOT_IN_OPTIONS))
                continue
            values[key] = provided

        else:
            issues.append(ValidationIssue(key, WRONG_TYPE))

    for key in provided_map:
        if key not in schema:
            issues.append(ValidationIssue(key, UNKNOWN_KEY))

    return ValidationResult(len(issues) == 0, tuple(issues), values)


def parameters_digest(values: dict) -> str:
    """FNV-1a 64 bits, identique à l'implémentation TypeScript (§6.1 versionnage)."""
    import json

    canonical = json.dumps(values, sort_keys=True, separators=(",", ":"), default=str)
    # TypeScript itère sur les code points UTF-16 : le digest sert de signature de
    # configuration, la version canonique ASCII garantit l'alignement des deux côtés.
    encoded = canonical.encode("utf-8")
    hash_value = 0xCBF29CE484222325
    for byte in encoded:
        hash_value ^= byte
        hash_value = (hash_value * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{hash_value:016x}"
