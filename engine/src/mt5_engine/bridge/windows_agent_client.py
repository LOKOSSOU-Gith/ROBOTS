"""Client HTTPS vers l'agent Windows qui héberge le terminal MT5 (§4).

Le VPS Contabo est Linux : le paquet officiel `MetaTrader5` ne peut pas y
fonctionner. Le moteur parle donc à un agent Windows dédié, sur un canal
privé (VPN réseau ou boucle chiffrée), avec un jeton de service.

Le corps de requête contenant le mot de passe n'est jamais journalisé : la
journalisation se limite au code et à l'identifiant de session (§10).
"""

from __future__ import annotations

import json
from typing import Any

import requests

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


class WindowsAgentBridge(TerminalBridge):
    kind = "windows_bridge"

    def __init__(self, base_url: str, token: str, timeout_seconds: float = 15.0) -> None:
        self._url = base_url.rstrip("/")
        self._timeout = timeout_seconds
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {token}"})

    # -------------------------------------------------------------- transport

    def _call(self, method: str, path: str, payload: dict | None = None) -> Any:
        try:
            response = self._session.request(
                method,
                f"{self._url}{path}",
                json=payload,
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            # `str(exc)` peut contenir l'URL : on ne journalise que le type.
            raise BridgeUnavailable(f"agent Windows injoignable: {type(exc).__name__}") from exc

        if response.status_code >= 500:
            raise BridgeUnavailable(f"agent Windows en erreur: {response.status_code}")
        if response.status_code == 401:
            raise BridgeUnavailable("jeton de pont refusé par l'agent Windows")
        try:
            return response.json()
        except ValueError as exc:
            raise BridgeUnavailable("réponse de pont illisible") from exc

    # --------------------------------------------------------------- contrat

    def connect(self, ref: AccountRef, password: str) -> ConnectionResult:
        body = {
            "account_id": ref.account_id,
            "server": ref.server,
            "login": ref.login,
            "environment": ref.environment,
            # transmis une seule fois, en mémoire, sur canal privé (§10)
            "password": password,
        }
        try:
            data = self._call("POST", "/v1/session/open", body)
        finally:
            body.pop("password", None)
        return ConnectionResult(
            connected=bool(data.get("connected")),
            code=str(data.get("code", "unknown")),
            message=_safe_message(data),
            terminal_kind=self.kind,
        )

    def disconnect(self, ref: AccountRef) -> None:
        self._call("POST", "/v1/session/close", {"account_id": ref.account_id})

    def is_connected(self, ref: AccountRef) -> bool:
        data = self._call("GET", f"/v1/session/{ref.account_id}")
        return bool(data.get("connected"))

    def ping(self) -> bool:
        try:
            data = self._call("GET", "/v1/ping")
        except BridgeUnavailable:
            return False
        return bool(data.get("terminal_running"))

    def account_info(self, ref: AccountRef) -> AccountInfo:
        data = self._call("GET", f"/v1/account/{ref.account_id}")
        return AccountInfo(
            equity=str(data["equity"]),
            balance=str(data["balance"]),
            margin_level_pct=str(data["margin_level_pct"]),
            currency=str(data.get("currency", "")),
            connected=bool(data.get("connected", True)),
        )

    def symbol_info(self, ref: AccountRef, broker_symbol: str) -> SymbolInfo:
        data = self._call(
            "GET", f"/v1/symbol/{ref.account_id}/{broker_symbol.upper()}"
        )
        return SymbolInfo(
            symbol=str(data["symbol"]),
            bid=str(data["bid"]),
            ask=str(data["ask"]),
            point=str(data["point"]),
            digits=int(data["digits"]),
            spread_points=int(data["spread_points"]),
            min_lot=str(data["volume_min"]),
            max_lot=str(data["volume_max"]),
            lot_step=str(data["volume_step"]),
            contract_size=int(data["trade_contract_size"]),
            point_value_per_lot=str(data["point_value_per_lot"]),
            trading_enabled=bool(data.get("trading_enabled", True)),
            volume_valid=bool(data.get("volume_valid", True)),
        )

    def positions(self, ref: AccountRef) -> list[PositionRecord]:
        data = self._call("GET", f"/v1/positions/{ref.account_id}")
        return [
            PositionRecord(
                position_id=str(row["position_id"]),
                symbol=str(row["symbol"]),
                side="buy" if int(row.get("type", 0)) == 0 else "sell",
                volume=str(row["volume"]),
                open_price=str(row["price_open"]),
                current_price=str(row.get("price_current", row["price_open"])),
                profit=str(row.get("profit", "0")),
                margin=str(row.get("margin", "0")),
                open_time_ms=int(row.get("time_ms", 0)),
                instance_id=row.get("instance_id"),
                magic=int(row["magic"]) if row.get("magic") is not None else None,
            )
            for row in data.get("positions", [])
        ]

    def rates(
        self, ref: AccountRef, broker_symbol: str, timeframe: str, count: int
    ) -> list[Candle]:
        data = self._call(
            "GET",
            f"/v1/rates/{ref.account_id}/{broker_symbol.upper()}/{timeframe.upper()}/{int(count)}",
        )
        return [
            Candle(
                time_ms=int(row["time_ms"]),
                open=str(row["open"]),
                high=str(row["high"]),
                low=str(row["low"]),
                close=str(row["close"]),
                volume=str(row.get("volume", "0")),
            )
            for row in data.get("rates", [])
        ]

    def send_order(self, ref: AccountRef, order: OrderRequest) -> OrderResult:
        data = self._call(
            "POST",
            "/v1/order",
            {
                "account_id": ref.account_id,
                "side": order.side,
                "symbol": order.symbol,
                "volume": order.volume,
                "action": order.action,
                "position_id": order.position_id,
                "stop_loss_points": order.stop_loss_points,
                "take_profit_points": order.take_profit_points,
                "deviation_points": order.deviation_points,
                "comment": order.comment,
                "instance_id": order.instance_id,
                "magic": order.magic,
            },
        )
        return _to_order_result(data)

    def close_position(self, ref: AccountRef, position_id: str) -> OrderResult:
        data = self._call(
            "POST",
            "/v1/order",
            {
                "account_id": ref.account_id,
                "action": "close",
                "position_id": position_id,
                "instance_id": None,
            },
        )
        return _to_order_result(data)

    def shutdown(self) -> None:
        self._session.close()


def _to_order_result(data: dict) -> OrderResult:
    return OrderResult(
        accepted=bool(data.get("accepted")),
        retcode=str(data.get("retcode", "unknown")),
        ticket=data.get("ticket"),
        price=data.get("price"),
        volume=data.get("volume"),
        message=_safe_message(data),
        details={k: v for k, v in data.items() if k not in {"password", "token"}},
    )


def _safe_message(data: dict) -> str:
    """Le message de l'agent est déjà technique ; on coupe toute fuite accidentelle."""
    message = str(data.get("message", ""))[:200]
    lowered = message.lower()
    if any(marker in lowered for marker in ("password", "mot de passe", "token", "secret")):
        return "[message masqué]"
    return message


def dumps_for_log(payload: dict) -> str:
    """Sérialisation destinée aux logs : les champs sensibles sont retirés avant."""
    forbidden = {"password", "token", "authorization", "secret"}
    return json.dumps({k: v for k, v in payload.items() if k not in forbidden})
