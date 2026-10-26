"""Agent Windows hébergeant le terminal MT5 (§4, §10, §12.3).

Le VPS Contabo du moteur est Linux : le paquet officiel `MetaTrader5` ne peut
pas y fonctionner. Cet agent s'exécute dans la VM Windows compatible, garde le
terminal, et n'expose qu'un contrat interne au moteur.

Sécurité :
 - service réservé au réseau privé (VPN ou interface interne) ;
 - jeton de service obligatoire sur chaque requête ;
 - le mot de passe reçu n'est jamais journalisé et n'est conservé que le temps
   de l'appel `initialize` (§10) ;
 - refus de démarrage hors Windows.

Liaison sur 0.0.0.0 sans TLS est refusée : un canal en clair divulguerait les
secrets de trading (§10, §12.3).
"""

from __future__ import annotations

import json
import os
import platform
import sys
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL_VERSION = "1"
FORBIDDEN_LOG_KEYS = ("password", "token", "authorization", "secret")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _load_mt5():
    import MetaTrader5 as mt5  # noqa: PLC0415 - import conditionnel par environnement

    return mt5


@dataclass
class Session:
    login: str
    server: str
    account_id: str
    handle: object


class Agent:
    """Traduction du contrat du pont vers les appels réels du terminal MT5."""

    def __init__(self) -> None:
        self._mt5 = _load_mt5()
        self._lock = threading.RLock()
        self._sessions: dict[str, Session] = {}
        self.terminal_path = _env("MT5_TERMINAL_PATH")

    # ------------------------------------------------------------- infrastructure

    def initialize(self) -> bool:
        kwargs = {"path": self.terminal_path} if self.terminal_path else {}
        return bool(self._mt5.initialize(timeout=20000, **kwargs))

    def shutdown(self) -> None:
        self._mt5.shutdown()

    def ping(self) -> dict:
        with self._lock:
            connected = bool(self._mt5.terminal_info())
            return {
                "terminal_running": connected,
                "protocol_version": PROTOCOL_VERSION,
                "build": int(getattr(self._mt5.terminal_info(), "build", 0) or 0)
                if connected
                else 0,
            }

    # ------------------------------------------------------------------ sessions

    def open_session(self, body: dict) -> dict:
        account_id = str(body["account_id"])
        login = str(body["login"])
        server = str(body["server"])
        password = str(body.get("password", ""))
        if not password:
            return {"connected": False, "code": "password_missing"}

        kwargs = {
            "login": int(login),
            "password": password,
            "server": server,
        }
        if self.terminal_path:
            kwargs["path"] = self.terminal_path
        # `password` n'est jamais copié dans un log ni dans une réponse (§10).
        ok = bool(self._mt5.login(**kwargs))
        if not ok:
            return {
                "connected": False,
                "code": f"mt5_{self._mt5.last_error()[0]}",
                "message": "authentification refusée",
            }
        with self._lock:
            self._sessions[account_id] = Session(login, server, account_id, account_id)
        return {"connected": True, "code": "connected", "message": "session ouverte"}

    def close_session(self, account_id: str) -> dict:
        with self._lock:
            self._sessions.pop(account_id, None)
        # `logout` n'existe pas dans l'API officielle : on referme la session
        # locale et on laisse le terminal gestionné par le service.
        return {"connected": False, "code": "closed"}

    def session_state(self, account_id: str) -> dict:
        with self._lock:
            known = account_id in self._sessions
        info = self._mt5.account_info()
        return {"connected": known and bool(info), "code": "ok"}

    # --------------------------------------------------------------------- lecture

    def _require_session(self, account_id: str) -> Session:
        with self._lock:
            session = self._sessions.get(account_id)
        if session is None:
            raise KeyError("session fermée")
        return session

    def account_info(self, account_id: str) -> dict:
        self._require_session(account_id)
        info = self._mt5.account_info()
        if info is None:
            raise RuntimeError("compte indisponible")
        return {
            "equity": _decimal(info.equity),
            "balance": _decimal(info.balance),
            "margin_level_pct": _decimal(getattr(info, "margin_level", 0) * 100),
            "currency": str(info.currency),
            "connected": True,
        }

    def symbol_info(self, account_id: str, symbol: str) -> dict:
        self._require_session(account_id)
        if not self._mt5.symbol_select(symbol, True):
            raise RuntimeError(f"symbole indisponible: {symbol}")
        tick = self._mt5.symbol_info_tick(symbol)
        raw = self._mt5.symbol_info(symbol)
        if raw is None or tick is None:
            raise RuntimeError("cotation indisponible")
        point = float(raw.point) or 0.0001
        spread_points = int(round((tick.ask - tick.bid) / point))
        # Valeur du point pour 1 lot, dans la devise du compte : calcul explicite,
        # jamais supposée identique d'un broker à l'autre (§6).
        tick_size = float(getattr(raw, "trade_tick_size", point)) or point
        tick_value = float(getattr(raw, "trade_tick_value", 0.0)) or 0.0
        point_value_per_lot = tick_value * (point / tick_size) if tick_size else 0.0
        return {
            "symbol": symbol,
            "bid": _decimal(tick.bid),
            "ask": _decimal(tick.ask),
            "point": _decimal(point),
            "digits": int(raw.digits),
            "spread_points": spread_points,
            "volume_min": _decimal(raw.volume_min),
            "volume_max": _decimal(raw.volume_max),
            "volume_step": _decimal(raw.volume_step),
            "trade_contract_size": int(raw.trade_contract_size),
            "point_value_per_lot": _decimal(point_value_per_lot),
            "trading_enabled": bool(getattr(raw, "trade_enabled", True)),
            "volume_valid": bool(getattr(raw, "volume_flags", 1) & 1)
            if getattr(raw, "volume_flags", None) is not None
            else True,
        }

    def rates(self, account_id: str, symbol: str, timeframe: str, count: int) -> dict:
        """Historique OHLC lu dans le terminal, jamais généré par l'agent."""
        self._require_session(account_id)
        constant = getattr(self._mt5, f"TIMEFRAME_{timeframe.upper()}", None)
        if constant is None:
            raise ValueError(f"timeframe inconnu: {timeframe}")
        if not self._mt5.symbol_select(symbol, True):
            raise RuntimeError(f"symbole indisponible: {symbol}")
        count = max(1, min(int(count), 1000))
        rows = self._mt5.copy_rates_from_pos(symbol, constant, 0, count) or ()
        return {
            "rates": [
                {
                    "time_ms": int(row["time"]) * 1000,
                    "open": _decimal(row["open"]),
                    "high": _decimal(row["high"]),
                    "low": _decimal(row["low"]),
                    "close": _decimal(row["close"]),
                    "volume": _decimal(row["tick_volume"]),
                }
                for row in rows
            ]
        }

    def positions(self, account_id: str) -> dict:
        self._require_session(account_id)
        rows = self._mt5.positions_get() or ()
        return {
            "positions": [
                {
                    "position_id": str(p.ticket),
                    "symbol": str(p.symbol),
                    "type": int(p.type),
                    "volume": _decimal(p.volume),
                    "price_open": _decimal(p.price_open),
                    "price_current": _decimal(p.price_current),
                    "profit": _decimal(p.profit),
                    "margin": _decimal(p.margin),
                    "time_ms": int(p.time) * 1000,
                    "magic": int(getattr(p, "magic", 0) or 0),
                    # L'appartenance d'une position est rattachée par commentaire :
                    # le moteur n'attribue que ce qu'il a lui-même envoyé (§13 T8).
                    "instance_id": _instance_from_comment(getattr(p, "comment", "")),
                }
                for p in rows
            ]
        }

    # --------------------------------------------------------------------- écriture

    def order(self, body: dict) -> dict:
        account_id = str(body["account_id"])
        self._require_session(account_id)
        action = str(body.get("action", "new"))

        if action == "close":
            return self._close_position(
                str(body["position_id"]), _magic_value(body.get("magic"), None)
            )

        symbol = str(body["symbol"])
        side = str(body["side"])
        volume = float(body["volume"])
        raw = self._mt5.symbol_info(symbol)
        tick = self._mt5.symbol_info_tick(symbol)
        if raw is None or tick is None:
            return {"accepted": False, "retcode": "no_market_data"}

        point = float(raw.point) or 0.0001
        request = {
            "action": self._mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": self._mt5.ORDER_TYPE_BUY if side == "buy" else self._mt5.ORDER_TYPE_SELL,
            "price": tick.ask if side == "buy" else tick.bid,
            "deviation": int(body.get("deviation_points", 20)),
            "comment": str(body.get("comment", ""))[:31],
            "magic": _magic_value(body.get("magic"), body.get("instance_id")),
            "type_time": self._mt5.ORDER_TIME_GTC,
            "type_filling": _filling_mode(raw, self._mt5),
        }
        stop_points = body.get("stop_loss_points")
        if stop_points:
            direction = -1 if side == "buy" else 1
            request["sl"] = _round_price(
                request["price"] + direction * float(stop_points) * point, int(raw.digits)
            )
        take_profit_points = body.get("take_profit_points")
        if take_profit_points:
            direction = 1 if side == "buy" else -1
            request["tp"] = _round_price(
                request["price"] + direction * float(take_profit_points) * point, int(raw.digits)
            )

        result = self._mt5.order_send(request)
        if result is None:
            return {"accepted": False, "retcode": f"mt5_{self._mt5.last_error()[0]}"}
        accepted = int(result.retcode) == int(self._mt5.TRADE_RETCODE_DONE) or int(
            result.retcode
        ) == int(self._mt5.TRADE_RETCODE_PLACED)
        return {
            "accepted": accepted,
            "retcode": str(result.retcode),
            "ticket": str(result.order) if accepted else None,
            "price": _decimal(result.price) if accepted else None,
            "volume": _decimal(result.volume) if accepted else None,
            "message": str(getattr(result, "comment", ""))[:120],
        }

    def _close_position(self, position_id: str, magic: int | None = None) -> dict:
        positions = self._mt5.positions_get(ticket=int(position_id)) or ()
        if not positions:
            return {"accepted": False, "retcode": "position_not_found"}
        position = positions[0]
        tick = self._mt5.symbol_info_tick(position.symbol)
        raw = self._mt5.symbol_info(position.symbol)
        if tick is None or raw is None:
            return {"accepted": False, "retcode": "no_market_data"}
        closing_type = (
            self._mt5.ORDER_TYPE_SELL
            if int(position.type) == int(self._mt5.POSITION_TYPE_BUY)
            else self._mt5.ORDER_TYPE_BUY
        )
        request = {
            "action": self._mt5.TRADE_ACTION_DEAL,
            "symbol": position.symbol,
            "volume": float(position.volume),
            "type": closing_type,
            "position": int(position.ticket),
            "price": tick.bid if closing_type == self._mt5.ORDER_TYPE_SELL else tick.ask,
            "deviation": 30,
            "comment": "close",
            "magic": magic if magic is not None else _magic_value(None, None),
            "type_time": self._mt5.ORDER_TIME_GTC,
            "type_filling": _filling_mode(raw, self._mt5),
        }
        result = self._mt5.order_send(request)
        if result is None:
            return {"accepted": False, "retcode": f"mt5_{self._mt5.last_error()[0]}"}
        accepted = int(result.retcode) == int(self._mt5.TRADE_RETCODE_DONE)
        return {
            "accepted": accepted,
            "retcode": str(result.retcode),
            "ticket": str(position.ticket),
            "price": _decimal(result.price) if accepted else None,
            "volume": _decimal(result.volume) if accepted else None,
        }


def _decimal(value) -> str:
    return f"{float(value or 0):.8f}".rstrip("0").rstrip(".") or "0"


def _round_price(price: float, digits: int) -> float:
    return round(price, digits)


def _filling_mode(raw, mt5) -> int:
    """Mode de remplissage lu sur le symbole : rien n'est supposé (§6, §7.1)."""
    flags = int(getattr(raw, "filling_mode", 0) or 0)
    if flags & 1:
        return int(mt5.ORDER_FILLING_FOK)
    if flags & 2:
        return int(mt5.ORDER_FILLING_IOC)
    return int(mt5.ORDER_FILLING_RETURN)


def _magic_value(magic, instance_id) -> int:
    """Magic fourni par le moteur, sinon dérivé de l'instance.

    Le magic est la source d'attribution prioritaire : le commentaire MT5 est
    limité à 31 caractères et ne peut pas contenir l'UUID complet.
    """
    try:
        value = int(magic)
        if 0 < value <= 2_147_483_647:
            return value
    except (TypeError, ValueError):
        pass
    return _magic(instance_id)


def _magic(instance_id) -> int:
    """Identifiant numérique de repli, dérivé et non séquentiel."""
    if not instance_id:
        return 700000
    digest = 0
    for char in str(instance_id):
        digest = (digest * 131 + ord(char)) & 0x7FFFFFFF
    return 700000 + (digest % 200000)


def _instance_from_comment(comment: str) -> str | None:
    prefix = "inst:"
    text = str(comment or "")
    if not text.startswith(prefix):
        return None
    token = text[len(prefix) :].strip()
    return token or None


class Handler(BaseHTTPRequestHandler):
    agent: Agent
    token: str

    def log_message(self, fmt: str, *args) -> None:  # journalisation remplacée
        # Aucune ligne d'accès standard : elle pourrait contenir une URL tokenisée.
        return

    # ------------------------------------------------------------ transport

    def _authorized(self) -> bool:
        header = self.headers.get("authorization", "")
        scheme, _, provided = header.partition(" ")
        return scheme.lower() == "bearer" and provided == self.token and bool(self.token)

    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(_purge(payload)).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("content-length", "0") or "0")
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {}

    def do_GET(self) -> None:  # noqa: N802 - signature http.server
        if not self._authorized():
            self._respond(401, {"error": "unauthorized"})
            return
        parts = [segment for segment in self.path.split("?")[0].split("/") if segment]
        try:
            self._route_get(parts)
        except Exception as exc:  # le type seul : les messages peuvent contenir un identifiant
            self._respond(500, {"error": type(exc).__name__})

    def _route_get(self, parts: list[str]) -> None:
        if parts == ["v1", "ping"]:
            self._respond(200, self.agent.ping())
            return
        if len(parts) == 3 and parts[1] == "session":
            self._respond(200, self.agent.session_state(parts[2]))
            return
        if len(parts) == 3 and parts[1] == "account":
            self._respond(200, self.agent.account_info(parts[2]))
            return
        if len(parts) == 4 and parts[1] == "symbol":
            self._respond(200, self.agent.symbol_info(parts[2], parts[3]))
            return
        if len(parts) == 3 and parts[1] == "positions":
            self._respond(200, self.agent.positions(parts[2]))
            return
        if len(parts) == 6 and parts[1] == "rates":
            self._respond(
                200,
                self.agent.rates(parts[2], parts[3], parts[4], int(parts[5])),
            )
            return
        self._respond(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802 - signature http.server
        if not self._authorized():
            self._respond(401, {"error": "unauthorized"})
            return
        parts = [segment for segment in self.path.split("?")[0].split("/") if segment]
        try:
            body = self._read_body()
            if parts == ["v1", "session", "open"]:
                self._respond(200, self.agent.open_session(body))
                return
            if parts == ["v1", "session", "close"]:
                self._respond(200, self.agent.close_session(str(body.get("account_id", ""))))
                return
            if parts == ["v1", "order"]:
                self._respond(200, self.agent.order(body))
                return
            self._respond(404, {"error": "not_found"})
        except Exception as exc:
            self._respond(500, {"error": type(exc).__name__})

    def do_DELETE(self) -> None:  # noqa: N802 - signature http.server
        self._respond(405, {"error": "method_not_allowed"})


def _purge(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k.lower() not in FORBIDDEN_LOG_KEYS}


def main() -> int:
    if platform.system() != "Windows":
        print(
            "Cet agent s'exécute uniquement dans un environnement Windows compatible "
            "avec MetaTrader5 (§4). Installez-le sur la VM Windows, pas sur le VPS Linux.",
            file=sys.stderr,
        )
        return 2

    token = _env("MT5_BRIDGE_TOKEN")
    if len(token) < 16:
        print("MT5_BRIDGE_TOKEN manquant ou trop court", file=sys.stderr)
        return 2

    bind = _env("MT5_BRIDGE_BIND", "127.0.0.1")
    port = int(_env("MT5_BRIDGE_PORT", "8443") or "8443")
    tls_cert = _env("MT5_BRIDGE_TLS_CERT")
    tls_key = _env("MT5_BRIDGE_TLS_KEY")

    if bind not in {"127.0.0.1", "localhost", "::1"} and not (tls_cert and tls_key):
        # Un pont en clair sur interface publique exposerait les secrets (§10).
        print(
            "liaison non-loopback exige MT5_BRIDGE_TLS_CERT et MT5_BRIDGE_TLS_KEY",
            file=sys.stderr,
        )
        return 2

    agent = Agent()
    if not agent.initialize():
        print("terminal MT5 injoignable : vérifier installation et session", file=sys.stderr)
        return 3

    Handler.agent = agent
    Handler.token = token
    server = ThreadingHTTPServer((bind, port), Handler)

    if tls_cert and tls_key:
        import ssl

        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(tls_cert, tls_key)
        server.socket = context.wrap_socket(server.socket, server_side=True)

    print(f"agent MT5 à l'écoute sur {bind}:{port} (tls: {bool(tls_cert)})", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        agent.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
