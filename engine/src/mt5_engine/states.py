"""États d'instance (§7.2) et transitions autorisées.

Le moteur est la source de l'état *confirmé*. Il refuse une transition
impossible plutôt que d'inventer un état : un robot ne peut pas passer
silencieusement de STOPPED à RUNNING.
"""

from __future__ import annotations

from enum import Enum


class InstanceState(str, Enum):
    STOPPED = "STOPPED"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    STOPPING = "STOPPING"
    ERROR = "ERROR"
    RISK_HALTED = "RISK_HALTED"
    DISCONNECTED = "DISCONNECTED"


# Table identique à celle du backend (src/server/domain/commands.ts) : les deux
# côtés doivent refuser les mêmes transitions, sinon l'état affiché diverge.
ALLOWED_TRANSITIONS: dict[InstanceState, tuple[InstanceState, ...]] = {
    InstanceState.STOPPED: (InstanceState.STARTING,),
    InstanceState.STARTING: (
        InstanceState.RUNNING,
        InstanceState.ERROR,
        InstanceState.STOPPING,
        InstanceState.DISCONNECTED,
    ),
    InstanceState.RUNNING: (
        InstanceState.STOPPING,
        InstanceState.ERROR,
        InstanceState.RISK_HALTED,
        InstanceState.DISCONNECTED,
    ),
    InstanceState.STOPPING: (InstanceState.STOPPED, InstanceState.ERROR),
    InstanceState.ERROR: (
        InstanceState.STARTING,
        InstanceState.STOPPING,
        InstanceState.STOPPED,
    ),
    InstanceState.RISK_HALTED: (
        InstanceState.STOPPING,
        InstanceState.STOPPED,
        InstanceState.STARTING,
    ),
    InstanceState.DISCONNECTED: (
        InstanceState.STARTING,
        InstanceState.STOPPING,
        InstanceState.STOPPED,
        InstanceState.ERROR,
    ),
}

# États pour lesquels le moteur pousse positions et événements régulièrement :
# un état stoppé n'a plus rien à surveiller (§14).
LIVE_STATES: frozenset[InstanceState] = frozenset(
    {InstanceState.STARTING, InstanceState.RUNNING, InstanceState.STOPPING}
)


def transition_allowed(current: InstanceState, target: InstanceState) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


class IllegalTransition(RuntimeError):
    def __init__(self, current: InstanceState, target: InstanceState) -> None:
        super().__init__(f"transition refusée: {current.value} -> {target.value}")
        self.current = current
        self.target = target


def parse_state(value: str) -> InstanceState:
    try:
        return InstanceState(value)
    except ValueError as exc:
        raise ValueError(f"état inconnu: {value!r}") from exc
