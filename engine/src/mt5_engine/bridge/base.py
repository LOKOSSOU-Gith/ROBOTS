"""Contrat du pont terminal (§4, §5, §8.1).

Toute exécution passe par cette interface. Les données sortantes du pont sont
des snapshots bruts de MT5 ; le moteur ne fait jamais confiance à un chiffre
provenant de la stratégie.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal


class BridgeUnavailable(RuntimeError):
    """Terminal ou broker inaccessible : aucune nouvelle entrée n'est possible."""


OrderSide = Literal["buy", "sell"]
OrderAction = Literal["new", "close", "modify"]


@dataclass(frozen=True)
class AccountRef:
    """Référence d'un compte MT5 côté moteur ; ne contient jamais le secret."""

    account_id: str
    server: str
    login: str
    environment: str = "demo"


@dataclass(frozen=True)
class ConnectionResult:
    connected: bool
    code: str
    # Message techniquement utile et déjà masqué (§10).
    message: str = ""
    terminal_kind: str = ""


@dataclass(frozen=True)
class PositionRecord:
    position_id: str
    symbol: str
    side: OrderSide
    volume: str
    open_price: str
    current_price: str
    profit: str
    margin: str
    open_time_ms: int
    instance_id: str | None = None
    # Attribution : le magic number est stable et tient sur 31 caractères de
    # commentaire. Une position sans magic connu n'est jamais attribuée à une
    # instance par supposition (§13 T8).
    magic: int | None = None


@dataclass(frozen=True)
class Candle:
    """Bougie OHLC brute, telle que fournie par le terminal."""

    time_ms: int
    open: str
    high: str
    low: str
    close: str
    volume: str = "0"


@dataclass(frozen=True)
class AccountInfo:
    equity: str
    balance: str
    margin_level_pct: str
    currency: str
    connected: bool


@dataclass(frozen=True)
class SymbolInfo:
    symbol: str
    bid: str
    ask: str
    point: str
    digits: int
    spread_points: int
    min_lot: str
    max_lot: str
    lot_step: str
    contract_size: int
    point_value_per_lot: str
    trading_enabled: bool
    volume_valid: bool


@dataclass(frozen=True)
class OrderRequest:
    side: OrderSide
    symbol: str
    volume: str
    action: OrderAction = "new"
    position_id: str | None = None
    stop_loss_points: int | None = None
    take_profit_points: int | None = None
    deviation_points: int = 20
    comment: str = ""
    # Corrélé à l'instance pour l'attribution des événements (§13 T8).
    instance_id: str | None = None
    magic: int | None = None


@dataclass(frozen=True)
class OrderResult:
    accepted: bool
    retcode: str
    ticket: str | None = None
    price: str | None = None
    volume: str | None = None
    message: str = ""
    details: dict = field(default_factory=dict)


class TerminalBridge(ABC):
    """Interface unique entre le moteur superviseur et l'exécution MT5."""

    kind: str = "unknown"

    @abstractmethod
    def connect(self, ref: AccountRef, password: str) -> ConnectionResult:
        """Établit la session. Le mot de passe reste en mémoire et n'est jamais journalisé."""

    @abstractmethod
    def disconnect(self, ref: AccountRef) -> None: ...

    @abstractmethod
    def is_connected(self, ref: AccountRef) -> bool: ...

    @abstractmethod
    def ping(self) -> bool:
        """Présence du terminal/broker, indépendante d'un compte (§14)."""

    @abstractmethod
    def account_info(self, ref: AccountRef) -> AccountInfo: ...

    @abstractmethod
    def symbol_info(self, ref: AccountRef, broker_symbol: str) -> SymbolInfo: ...

    @abstractmethod
    def positions(self, ref: AccountRef) -> list[PositionRecord]: ...

    @abstractmethod
    def rates(
        self, ref: AccountRef, broker_symbol: str, timeframe: str, count: int
    ) -> list[Candle]:
        """Historique OHLC ; une liste vide interdit tout signal, jamais il ne
        fait deviner une tendance (§6)."""

    @abstractmethod
    def send_order(self, ref: AccountRef, order: OrderRequest) -> OrderResult: ...

    @abstractmethod
    def close_position(self, ref: AccountRef, position_id: str) -> OrderResult:
        """Clôture unitaire, utilisée par la liquidation d'urgence (§7.2)."""

    def shutdown(self) -> None:
        """Nettoyage du processus ; surchargeable par le pont Windows."""

    def forget_secret(self, ref: AccountRef) -> None:
        """Révoque la copie locale du secret après usage (§10)."""
        return None
