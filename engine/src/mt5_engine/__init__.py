"""Moteur d'exécution Python (§4, §7, §8.1).

Le paquet officiel `MetaTrader5` n'est importable que dans un environnement
Windows compatible. Sur un VPS Contabo Linux, ce module ne l'importe jamais :
le pont terminal (`bridge/`) dialogue avec un agent Windows ou avec le
simulateur utilisé en P0/T5 (§4 "Compatibilité essentielle").
"""

__version__ = "0.1.0"
