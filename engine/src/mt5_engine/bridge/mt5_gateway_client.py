"""Client HTTP vers mt5-gateway (MT5 sous Wine sur Ubuntu).

mt5-gateway est un service Docker qui fait tourner MT5 sous Wine et expose
une API REST. Contrairement à l'agent Windows, mt5-gateway ne gère qu'un seul
compte MT5 par instance (défini via variables d'environnement).

Documentation: https://mt5.tryqkt.com/reference/api/
"""

from __future__ import annotations

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


class Mt5GatewayBridge(TerminalBridge):
    kind = "mt5_gateway"

    def __init__(self, base_url: str, api_key: str, timeout_seconds: float = 15.0) -> None:
        self._url = base_url.rstrip("/")
        self._timeout = timeout_seconds
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {api_key}"})

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
            raise BridgeUnavailable(f"mt5-gateway injoignable: {type(exc).__name__}") from exc

        if response.status_code >= 500:
            raise BridgeUnavailable(f"mt5-gateway en erreur: {response.status_code}")
        if response.status_code == 401:
            raise BridgeUnavailable("API key refusée par mt5-gateway")
        if response.status_code == 503:
            raise BridgeUnavailable("mt5-gateway non prêt (terminal non connecté)")

        try:
            return response.json()
        except ValueError as exc:
            raise BridgeUnavailable("réponse mt5-gateway illisible") from exc

    # --------------------------------------------------------------- contrat

    def connect(self, ref: AccountRef, password: str) -> ConnectionResult:
        """mt5-gateway gère la connexion via ses variables d'environnement.
        
        Cette méthode vérifie simplement que le gateway est prêt et connecté.
        Le mot de passe n'est pas utilisé ici - il est configuré au démarrage du gateway.
        """
        try:
            data = self._call("GET", "/health/ready")
        except BridgeUnavailable as exc:
            return ConnectionResult(
                connected=False,
                code="gateway_unavailable",
                message=str(exc),
                terminal_kind=self.kind,
            )

        if data.get("status") == "ready":
            # Vérifier que le compte correspond
            health = self._call("GET", "/health")
            mt5_account = health.get("mt5_account", {})
            if mt5_account.get("login") == ref.login:
                return ConnectionResult(
                    connected=True,
                    code="ready",
                    message="mt5-gateway prêt et connecté",
                    terminal_kind=self.kind,
                )
            else:
                return ConnectionResult(
                    connected=False,
                    code="account_mismatch",
                    message=f"Compte mismatch: gateway={mt5_account.get('login')}, demandé={ref.login}",
                    terminal_kind=self.kind,
                )

        return ConnectionResult(
            connected=False,
            code="not_ready",
            message="mt5-gateway non prêt",
            terminal_kind=self.kind,
        )

    def disconnect(self, ref: AccountRef) -> None:
        """mt5-gateway ne supporte pas la déconnexion à la demande.
        
        Pour déconnecter, il faut redémarrer le conteneur Docker avec de nouveaux credentials.
        """
        pass

    def is_connected(self, ref: AccountRef) -> bool:
        try:
            data = self._call("GET", "/health/ready")
            return data.get("status") == "ready"
        except BridgeUnavailable:
            return False

    def ping(self) -> bool:
        try:
            data = self._call("GET", "/health/live")
            return data.get("status") == "ok"
        except BridgeUnavailable:
            return False

    def account_info(self, ref: AccountRef) -> AccountInfo:
        data = self._call("GET", "/account")
        return AccountInfo(
            equity=str(data.get("equity", "0")),
            balance=str(data.get("balance", "0")),
            margin_level_pct=str(data.get("margin_level", "0")),
            currency=str(data.get("currency", "")),
            connected=True,  # Si on a une réponse, c'est connecté
        )

    def symbol_info(self, ref: AccountRef, broker_symbol: str) -> SymbolInfo:
        data = self._call("GET", f"/symbol_info/{broker_symbol}")
        return SymbolInfo(
            symbol=str(data.get("symbol", broker_symbol)),
            bid=str(data.get("bid", "0")),
            ask=str(data.get("ask", "0")),
            point=str(data.get("point", "0")),
            digits=int(data.get("digits", 2)),
            spread_points=int(data.get("spread", 0)),
            min_lot=str(data.get("volume_min", "0.01")),
            max_lot=str(data.get("volume_max", "100")),
            lot_step=str(data.get("volume_step", "0.01")),
            contract_size=int(data.get("trade_contract_size", 100000)),
            point_value_per_lot=str(data.get("point_value", "0")),
            trading_enabled=bool(data.get("trade_mode", 0) != 2),  # 2 = disabled
            volume_valid=True,
        )

    def positions(self, ref: AccountRef) -> list[PositionRecord]:
        data = self._call("GET", "/positions")
        return [
            PositionRecord(
                position_id=str(row["ticket"]),
                symbol=str(row["symbol"]),
                side="buy" if int(row.get("type", 0)) == 0 else "sell",
                volume=str(row["volume"]),
                open_price=str(row["price_open"]),
                current_price=str(row.get("price_current", row["price_open"])),
                profit=str(row.get("profit", "0")),
                margin=str(row.get("margin", "0")),
                open_time_ms=int(row.get("time", 0)) * 1000,  # MT5 donne des secondes
                instance_id=row.get("comment", ""),  # mt5-gateway n'a pas d'instance_id
                magic=int(row.get("magic", 0)) if row.get("magic") else None,
            )
            for row in data.get("positions", [])
        ]

    def rates(
        self, ref: AccountRef, broker_symbol: str, timeframe: str, count: int
    ) -> list[Candle]:
        # mt5-gateway utilise fetch_data_pos
        params = {
            "symbol": broker_symbol,
            "timeframe": timeframe,
            "num_bars": count,
        }
        data = self._call("GET", "/fetch_data_pos", params=params)
        return [
            Candle(
                time_ms=int(row["time"]) * 1000,  # MT5 donne des secondes
                open=str(row["open"]),
                high=str(row["high"]),
                low=str(row["low"]),
                close=str(row["close"]),
                volume=str(row.get("tick_volume", "0")),
            )
            for row in data.get("data", [])
        ]

    def send_order(self, ref: AccountRef, order: OrderRequest) -> OrderResult:
        body = {
            "symbol": order.symbol,
            "volume": float(order.volume),
            "type": 0 if order.side == "buy" else 1,  # 0 = buy, 1 = sell
        }

        if order.action == "close" and order.position_id:
            body["type"] = 2  # 2 = close
            body["position"] = int(order.position_id)
        else:
            if order.stop_loss_points:
                body["sl"] = float(order.stop_loss_points)
            if order.take_profit_points:
                body["tp"] = float(order.take_profit_points)
            if order.comment:
                body["comment"] = order.comment
            if order.magic:
                body["magic"] = order.magic
            if order.deviation_points:
                body["deviation"] = order.deviation_points

        data = self._call("POST", "/order", body)
        return OrderResult(
            accepted=data.get("retcode") == 0,  # 0 = success
            retcode=str(data.get("retcode", "unknown")),
            ticket=str(data.get("order")) if data.get("order") else None,
            price=str(data.get("price")) if data.get("price") else None,
            volume=str(data.get("volume")) if data.get("volume") else None,
            comment=data.get("comment", ""),
        )

    def close_position(self, ref: AccountRef, position_id: str) -> OrderResult:
        body = {
            "type": 2,  # close
            "position": int(position_id),
        }
        data = self._call("POST", "/order", body)
        return OrderResult(
            accepted=data.get("retcode") == 0,
            retcode=str(data.get("retcode", "unknown")),
            ticket=str(data.get("order")) if data.get("order") else None,
            comment=data.get("comment", ""),
        )

    def shutdown(self) -> None:
        self._session.close()
