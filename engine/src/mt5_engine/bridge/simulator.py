"""Simulateur de terminal MT5 (§12, §13).

Utilisé par P0 (validation technique hors production) et par les tests T1-T2,
T4, T7 : cotations figées, calculs entiers, résultats déterministes, pannes
injectables (rejet d'ordre, terminal coupé) sans broker réel.

Aucune exécution en mode réel : `environment="real"` est refusé (§1, §16).
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field, replace

from ..volume import LotConstraints, SCALE, from_scaled, resolve_lot, to_scaled
from .base import (
    AccountInfo,
    Candle,
    AccountRef,
    BridgeUnavailable,
    ConnectionResult,
    OrderRequest,
    OrderResult,
    PositionRecord,
    SymbolInfo,
    TerminalBridge,
)

LEVERAGE = 100  # 1:100, suffisant pour les tests de marge

# Cotations figées : mêmes entrées, mêmes sorties (§13 T1).
_DEFAULT_SYMBOLS: dict[str, dict] = {
    "XAUUSD": {
        "bid": "2400.00",
        "ask": "2400.30",
        "point": "0.01",
        "digits": 2,
        "min_lot": "0.01",
        "max_lot": "100",
        "lot_step": "0.01",
        "contract_size": 100,
        "point_value_per_lot": "1",
    },
    "EURUSD": {
        "bid": "1.0850",
        "ask": "1.0851",
        "point": "0.0001",
        "digits": 4,
        "min_lot": "0.01",
        "max_lot": "50",
        "lot_step": "0.01",
        "contract_size": 100000,
        "point_value_per_lot": "1",
    },
    "GBPUSD": {
        "bid": "1.2700",
        "ask": "1.2702",
        "point": "0.0001",
        "digits": 4,
        "min_lot": "0.01",
        "max_lot": "50",
        "lot_step": "0.01",
        "contract_size": 100000,
        "point_value_per_lot": "1",
    },
    "USDJPY": {
        "bid": "150.00",
        "ask": "150.01",
        "point": "0.01",
        "digits": 2,
        "min_lot": "0.01",
        "max_lot": "50",
        "lot_step": "0.01",
        "contract_size": 100000,
        "point_value_per_lot": "0.67",
    },
}

_TIMEFRAME_MS = {
    "M1": 60_000,
    "M5": 300_000,
    "M15": 900_000,
    "M30": 1_800_000,
    "H1": 3_600_000,
    "H4": 14_400_000,
    "D1": 86_400_000,
}


@dataclass
class _Session:
    login: str
    balance: int
    peak_equity: int
    margin: int = 0
    realized_today: int = 0
    positions: dict[str, PositionRecord] = field(default_factory=dict)
    next_ticket: int = 1000


class SimulatorBridge(TerminalBridge):
    """Exécutant local, sans dépendance à Windows ni au paquet MetaTrader5."""

    kind = "simulator"

    def __init__(
        self,
        *,
        initial_balance: str = "10000",
        starting_equity: str | None = None,
        symbols: dict[str, dict] | None = None,
    ) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, _Session] = {}
        self._symbols = {**_DEFAULT_SYMBOLS, **(symbols or {})}
        self._starting_equity = to_scaled(starting_equity or initial_balance)
        # Injections de défaillances, pilotées par les tests T5-T7.
        self.force_disconnect = False
        self.reject_next_order = False

    # -------------------------------------------------------------- connexion

    def connect(self, ref: AccountRef, password: str) -> ConnectionResult:
        if ref.environment == "real":
            return ConnectionResult(
                False,
                "simulator_refuses_real",
                "le mode réel exige un terminal MT5 et une double autorisation (§1, §16)",
                self.kind,
            )
        if not password:
            return ConnectionResult(False, "invalid_credentials", "mot de passe manquant")
        if self.force_disconnect:
            return ConnectionResult(False, "terminal_unreachable", "terminal indisponible")
        with self._lock:
            if ref.account_id not in self._sessions:
                self._sessions[ref.account_id] = _Session(
                    login=ref.login,
                    balance=self._starting_equity,
                    peak_equity=self._starting_equity,
                )
        return ConnectionResult(True, "connected", "session simulée", self.kind)

    def disconnect(self, ref: AccountRef) -> None:
        with self._lock:
            self._sessions.pop(ref.account_id, None)

    def is_connected(self, ref: AccountRef) -> bool:
        return not self.force_disconnect and ref.account_id in self._sessions

    def ping(self) -> bool:
        return not self.force_disconnect

    # -------------------------------------------------------------- lecture

    def _session(self, ref: AccountRef) -> _Session:
        if self.force_disconnect:
            raise BridgeUnavailable("terminal indisponible")
        session = self._sessions.get(ref.account_id)
        if session is None:
            raise BridgeUnavailable("session MT5 non ouverte")
        return session

    def _symbol(self, broker_symbol: str) -> dict:
        raw = self._symbols.get(broker_symbol.upper())
        if raw is None:
            raise BridgeUnavailable(f"symbole inconnu: {broker_symbol}")
        return raw

    def account_info(self, ref: AccountRef) -> AccountInfo:
        with self._lock:
            session = self._session(ref)
            unrealized = sum(
                self._profit(p) for p in session.positions.values()
            )
            equity = session.balance + session.realized_today + unrealized
            session.peak_equity = max(session.peak_equity, equity)
            margin_level = (
                (equity * to_scaled("100")) // session.margin if session.margin else 0
            )
            return AccountInfo(
                equity=from_scaled(equity),
                balance=from_scaled(session.balance + session.realized_today),
                margin_level_pct=from_scaled(margin_level),
                currency="USD",
                connected=True,
            )

    def symbol_info(self, ref: AccountRef, broker_symbol: str) -> SymbolInfo:
        self._session(ref)
        raw = self._symbol(broker_symbol)
        bid, ask, point = (
            to_scaled(raw["bid"]),
            to_scaled(raw["ask"]),
            to_scaled(raw["point"]),
        )
        return SymbolInfo(
            symbol=broker_symbol.upper(),
            bid=raw["bid"],
            ask=raw["ask"],
            point=raw["point"],
            digits=int(raw["digits"]),
            spread_points=int((ask - bid) // point) if point else 0,
            min_lot=raw["min_lot"],
            max_lot=raw["max_lot"],
            lot_step=raw["lot_step"],
            contract_size=int(raw["contract_size"]),
            point_value_per_lot=raw["point_value_per_lot"],
            trading_enabled=True,
            volume_valid=True,
        )

    def positions(self, ref: AccountRef) -> list[PositionRecord]:
        with self._lock:
            session = self._session(ref)
            refreshed: list[PositionRecord] = []
            for position in session.positions.values():
                current_price = self._symbol(position.symbol)["bid"]
                marked = replace(
                    position,
                    current_price=current_price,
                    profit=from_scaled(self._profit(position)),
                )
                refreshed.append(marked)
            return refreshed

    def rates(
        self, ref: AccountRef, broker_symbol: str, timeframe: str, count: int
    ) -> list[Candle]:
        """Série synthétique déterministe, clairement non marchande.

        Elle sert à tester le câblage et les stratégies, jamais à prétendre
        reproduire un historique de broker.
        """
        self._session(ref)
        raw = self._symbol(broker_symbol)
        count = max(10, min(int(count), 1000))
        step_ms = _TIMEFRAME_MS.get(timeframe.upper(), 900_000)
        base = float(raw["bid"])
        offset = sum(ord(char) for char in broker_symbol.upper()) % 17
        now_ms = int(time.time() * 1000)
        candles: list[Candle] = []
        previous_close = base
        for index in range(count):
            phase = (index + offset) / 7.0
            close = base * (1.0 + 0.012 * math.sin(phase) + 0.004 * math.sin(phase / 3.7))
            open_price = previous_close
            high = max(open_price, close) * 1.0004
            low = min(open_price, close) * 0.9996
            candles.append(
                Candle(
                    time_ms=now_ms - (count - index) * step_ms,
                    open=_price(open_price, int(raw["digits"])),
                    high=_price(high, int(raw["digits"])),
                    low=_price(low, int(raw["digits"])),
                    close=_price(close, int(raw["digits"])),
                    volume="1000",
                )
            )
            previous_close = close
        return candles

    # -------------------------------------------------------------- écriture

    def send_order(self, ref: AccountRef, order: OrderRequest) -> OrderResult:
        with self._lock:
            session = self._session(ref)
            try:
                raw = self._symbol(order.symbol)
            except BridgeUnavailable as exc:
                return OrderResult(False, "10013", message=str(exc))

            if self.force_disconnect:
                return OrderResult(False, "10001", message="terminal indisponible")
            if self.reject_next_order:
                self.reject_next_order = False
                return OrderResult(False, "10004", message="rejet simulé (marché fermé)")

            resolution = resolve_lot(
                order.volume,
                LotConstraints(raw["min_lot"], raw["max_lot"], raw["lot_step"]),
            )
            if resolution.volume is None:
                return OrderResult(
                    False, "10015", message=f"volume refusé: {resolution.rejected_reason}"
                )

            fill = raw["ask"] if order.side == "buy" else raw["bid"]
            position_id = str(session.next_ticket)
            session.next_ticket += 1
            margin = _margin_scaled(to_scaled(resolution.volume), to_scaled(fill), int(raw["contract_size"]))
            session.margin += margin
            session.positions[position_id] = PositionRecord(
                position_id=position_id,
                symbol=order.symbol.upper(),
                side=order.side,
                volume=resolution.volume,
                open_price=fill,
                current_price=fill,
                profit="0",
                margin=from_scaled(margin),
                open_time_ms=0,
                instance_id=order.instance_id,
                magic=order.magic,
            )
            return OrderResult(
                True,
                "10009",
                ticket=position_id,
                price=fill,
                volume=resolution.volume,
                message="position ouverte (simulée)",
            )

    def close_position(self, ref: AccountRef, position_id: str) -> OrderResult:
        with self._lock:
            session = self._session(ref)
            position = session.positions.pop(position_id, None)
            if position is None:
                return OrderResult(False, "10004", message="position inconnue")
            realized = self._profit(position)
            session.realized_today += realized
            session.margin = max(0, session.margin - to_scaled(position.margin))
            return OrderResult(
                True,
                "10009",
                ticket=position_id,
                price=position.current_price,
                volume=position.volume,
                message="position fermée (simulée)",
                details={"realized": from_scaled(realized)},
            )

    # ---------------------------------------------------------- injections test

    def inject_daily_pnl(self, ref: AccountRef, realized: str) -> None:
        """Force le PNL réalisé du jour : utilisé par T2 et T7."""
        with self._lock:
            self._session(ref).realized_today = to_scaled(realized)

    def set_equity(self, ref: AccountRef, equity: str) -> None:
        with self._lock:
            session = self._session(ref)
            session.balance = to_scaled(equity)
            session.realized_today = 0
            session.peak_equity = max(session.peak_equity, to_scaled(equity))

    def roll_day(self, ref: AccountRef) -> None:
        """Nouveau jour de cotation : la perte journalière repart à zéro (§7.1)."""
        with self._lock:
            session = self._session(ref)
            session.balance += session.realized_today
            session.realized_today = 0

    # ----------------------------------------------------------------- interne

    def _profit(self, position: PositionRecord) -> int:
        """Profit réalisé+flottant d'une position, en devise à l'échelle 1e8."""
        raw = self._symbols.get(position.symbol)
        if raw is None:
            return 0
        point = to_scaled(raw["point"])
        if point <= 0:
            return 0
        open_price = to_scaled(position.open_price)
        current = to_scaled(position.current_price)
        direction = 1 if position.side == "buy" else -1
        points = ((current - open_price) * direction) // point
        point_value = to_scaled(raw["point_value_per_lot"])
        volume = to_scaled(position.volume)
        return (points * point_value * volume) // SCALE


def _margin_scaled(volume: int, price: int, contract_size: int) -> int:
    """Notionnel / levier, entiers à l'échelle 1e8."""
    notional = (volume * price) // SCALE * contract_size
    return notional // LEVERAGE


def _price(value: float, digits: int) -> str:
    return f"{value:.{digits}f}"
