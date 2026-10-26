"""Contrôles de risque exécutés dans le moteur (§7.1).

Ces contrôles tournent même si le navigateur est fermé : ils constituent la
dernière barrière avant l'envoi d'un ordre. Un seuil atteint bloque les
nouvelles entrées ; un dépassement de perte journalière ou de drawdown place
en outre l'instance en RISK_HALTED.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .anti_martingale import Position, total_exposure
from .volume import NumberFormatError, from_scaled, to_scaled

# Codes de blocage, stables et courts pour l'API et les alertes (§14).
BLOCK_DAILY_LOSS = "max_daily_loss"
BLOCK_DRAWDOWN = "max_drawdown"
BLOCK_EXPOSURE = "max_total_exposure"
BLOCK_POSITIONS = "max_open_positions"
BLOCK_SPREAD = "max_spread"
BLOCK_MARGIN = "min_margin_level"
BLOCK_LOSS_FLAG = "forbid_lot_increase_after_loss"
BLOCK_DUPLICATE = "duplicate_order"
BLOCK_SYMBOL_RULES = "broker_symbol_rules"
BLOCK_UNREADABLE = "risk_profile_unreadable"


@dataclass(frozen=True)
class RiskLimits:
    max_daily_loss: str
    max_drawdown_pct: str
    max_open_positions: int
    max_total_exposure: str
    max_spread_points: int
    min_margin_level_pct: str
    max_risk_per_trade_pct: str
    max_lot_size: str
    forbid_lot_increase_after_loss: bool = True

    @classmethod
    def from_runtime(cls, risk: dict) -> "RiskLimits":
        return cls(
            max_daily_loss=str(risk.get("max_daily_loss", "0")),
            max_drawdown_pct=str(risk.get("max_drawdown_pct", "0")),
            max_open_positions=int(risk.get("max_open_positions", 1)),
            max_total_exposure=str(risk.get("max_total_exposure", "0")),
            max_spread_points=int(risk.get("max_spread_points", 0)),
            min_margin_level_pct=str(risk.get("min_margin_level_pct", "0")),
            max_risk_per_trade_pct=str(risk.get("max_risk_per_trade_pct", "0")),
            max_lot_size=str(risk.get("max_lot_size", "0")),
            forbid_lot_increase_after_loss=bool(
                risk.get("forbid_lot_increase_after_loss", True)
            ),
        )


@dataclass(frozen=True)
class AccountSnapshot:
    """État lu dans MT5 ; aucune de ces valeurs n'est fournie par la stratégie."""

    equity: str
    balance: str
    margin_level_pct: str
    daily_realized_pnl: str
    peak_equity: str
    open_positions: tuple[Position, ...] = ()


@dataclass(frozen=True)
class SymbolSnapshot:
    symbol: str
    spread_points: int
    min_lot: str
    max_lot: str
    lot_step: str
    point_value_per_lot: str
    digits: int
    contract_size: int
    trading_enabled: bool


@dataclass(frozen=True)
class RiskCheck:
    allowed: bool
    code: str | None = None
    detail: str | None = None
    halt_required: bool = False
    observations: dict = field(default_factory=dict)


def _readable(value: str) -> bool:
    try:
        to_scaled(value)
        return True
    except NumberFormatError:
        return False


def compute_drawdown_pct(equity: str, peak_equity: str) -> int:
    """Drawdown courant en pourcentage à l'échelle 1e8 ; 0 si l'équité est au sommet."""
    peak = to_scaled(peak_equity)
    current = to_scaled(equity)
    if peak <= 0 or current >= peak:
        return 0
    return ((peak - current) * to_scaled("100")) // peak


@dataclass(frozen=True)
class TradeIntent:
    """Ce que la stratégie veut exécuter ; le moteur décide."""

    requested_volume: str
    baseline_volume: str
    previous_loss_occurred: bool
    duplicate_of_open_position: bool


def check_pre_trade(
    limits: RiskLimits,
    account: AccountSnapshot,
    symbol: SymbolSnapshot,
    intent: TradeIntent,
) -> RiskCheck:
    """Contrôles critiques précédant l'envoi d'un ordre (§7.1, §6.1)."""

    for value in (limits.max_daily_loss, limits.max_drawdown_pct, limits.max_lot_size):
        if not _readable(value):
            # Une limite illisible bloque plutôt qu'elle ne négocie à l'aveugle.
            return RiskCheck(False, BLOCK_UNREADABLE, "profil de risque illisible", True)

    daily_loss_limit = to_scaled(limits.max_daily_loss)
    daily_pnl = to_scaled(account.daily_realized_pnl)
    if daily_loss_limit > 0 and daily_pnl < 0 and -daily_pnl >= daily_loss_limit:
        return RiskCheck(
            False,
            BLOCK_DAILY_LOSS,
            f"perte journalière {from_scaled(daily_pnl)} atteignant {limits.max_daily_loss}",
            True,
            {"daily_pnl": from_scaled(daily_pnl)},
        )

    drawdown = compute_drawdown_pct(account.equity, account.peak_equity)
    max_drawdown = to_scaled(limits.max_drawdown_pct)
    if max_drawdown > 0 and drawdown >= max_drawdown:
        return RiskCheck(
            False,
            BLOCK_DRAWDOWN,
            f"drawdown {from_scaled(drawdown)}% >= {limits.max_drawdown_pct}%",
            True,
            {"drawdown_pct": from_scaled(drawdown)},
        )

    min_margin = to_scaled(limits.min_margin_level_pct)
    margin_level = to_scaled(account.margin_level_pct)
    if min_margin > 0 and margin_level < min_margin:
        return RiskCheck(
            False,
            BLOCK_MARGIN,
            f"niveau de marge {from_scaled(margin_level)}% < {limits.min_margin_level_pct}%",
        )

    if symbol.spread_points > limits.max_spread_points:
        return RiskCheck(
            False,
            BLOCK_SPREAD,
            f"spread {symbol.spread_points} pts > limite {limits.max_spread_points}",
            observations={"spread_points": symbol.spread_points},
        )

    if len(account.open_positions) >= limits.max_open_positions:
        return RiskCheck(
            False,
            BLOCK_POSITIONS,
            f"{len(account.open_positions)} position(s) >= max {limits.max_open_positions}",
        )

    if not symbol.trading_enabled:
        return RiskCheck(
            False, BLOCK_SYMBOL_RULES, f"symbole {symbol.symbol} non négociable"
        )

    requested = to_scaled(intent.requested_volume)
    ceiling = to_scaled(limits.max_lot_size)
    if requested > ceiling:
        return RiskCheck(
            False,
            "max_lot_size",
            f"volume {intent.requested_volume} > plafond {limits.max_lot_size}",
            True,
        )

    # Le drapeau anti-Martingale du profil est revérifié ici : une stratégie
    # ne peut pas le contourner, même buguée (§6.1).
    if limits.forbid_lot_increase_after_loss and intent.previous_loss_occurred:
        if requested > to_scaled(intent.baseline_volume):
            return RiskCheck(
                False,
                BLOCK_LOSS_FLAG,
                "hausse de lot après perte interdite par le profil de risque",
                True,
            )

    exposure_limit = to_scaled(limits.max_total_exposure)
    if exposure_limit > 0:
        projected_positions = [
            *account.open_positions,
            Position(intent.requested_volume, symbol.min_lot, symbol.contract_size),
        ]
        projected = to_scaled(total_exposure(projected_positions))
        if projected > exposure_limit:
            return RiskCheck(
                False,
                BLOCK_EXPOSURE,
                f"exposition projetée au-delà de {limits.max_total_exposure}",
                {"exposure": from_scaled(projected)},
            )

    if intent.duplicate_of_open_position:
        return RiskCheck(False, BLOCK_DUPLICATE, "ordre répété déjà présent")

    return RiskCheck(True, observations={"drawdown_pct": from_scaled(drawdown)})
