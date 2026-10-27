# Guide d'installation du moteur MT5 sur VPS Ubuntu avec Wine

Ce guide couvre l'installation du moteur Python et de MetaTrader 5 sur un VPS Ubuntu en utilisant Wine pour la compatibilité MT5.

## 📋 Prérequis

- VPS Ubuntu 24.04 (Contabo)
- Accès SSH au VPS
- Python 3.10+ sera installé automatiquement
- Wine déjà installé (comme vous l'avez fait)

## 🚀 Installation automatique

Le script `install.sh` automatise l'installation complète.

### Étape 1: Télécharger les fichiers

Depuis votre machine locale, copiez vers le VPS via SCP:

```bash
# Copier le dossier engine/
scp -r engine/ elise@169.58.157.94:/home/elise/mt5-engine

# Copier le dossier linux-setup/
scp -r engine/linux-setup/ elise@169.58.157.94:/home/elise/mt5-setup
```

### Étape 2: Exécuter le script d'installation

```bash
ssh elise@169.58.157.94
cd mt5-setup
chmod +x install.sh
./install.sh
```

Le script va:
- ✅ Installer Python 3.10 et pip
- ✅ Installer les dépendances Python
- ✅ Configurer l'environnement virtuel
- ✅ Créer le service systemd pour le moteur
- ✅ Configurer le fichier .env
- ✅ Configurer Wine pour MT5

### Étape 3: Installer MetaTrader 5

MetaTrader 5 doit être installé via Wine:

```bash
# Télécharger MT5 depuis votre broker (exemple pour un broker fictif)
cd /home/elise/mt5-mt5
wget https://download.broker.com/mt5setup.exe

# Installer avec Wine
wine mt5setup.exe

# Configurer Wine pour utiliser le bon préfixe
export WINEPREFIX=/home/elise/.wine-mt5
winecfg
```

### Étape 4: Configurer le moteur

Éditez le fichier `.env`:

```bash
nano /home/elise/mt5-engine/engine/.env
```

Configurez:

```env
# Backend
BACKEND_URL=https://votre-domaine.vercel.app
ENGINE_AUTH_SECRET=votre-secret-32-caractères-minimum
ENGINE_SERVICE_ID=contabo-engine-01

# MT5 (Wine)
MT5_PATH=/home/elise/.wine-mt5/drive_c/Program Files/MetaTrader 5/terminal64.exe
MT5_CONFIG_PATH=/home/elise/.wine-mt5/drive_c/Program Files/MetaTrader 5

# Logs
LOG_LEVEL=info
```

### Étape 5: Démarrer le service

```bash
sudo systemctl start mt5-engine
sudo systemctl enable mt5-engine

# Vérifier le statut
sudo systemctl status mt5-engine
```

## 🔧 Installation manuelle

Si vous préférez une installation manuelle:

### 1. Installer Python et dépendances

```bash
sudo apt update
sudo apt install -y python3.10 python3.10-venv python3-pip
```

### 2. Configurer le moteur

```bash
cd /home/elise/mt5-engine/engine

# Créer l'environnement virtuel
python3.10 -m venv .venv
source .venv/bin/activate

# Installer les dépendances
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Installer MetaTrader5 Python Library

```bash
# La bibliothèque MetaTrader5 Python ne fonctionne que sur Windows natif
# Sur Linux avec Wine, vous devrez peut-être utiliser une alternative
# ou exécuter Python via Wine
```

### 4. Créer le service systemd

Créez `/etc/systemd/system/mt5-engine.service`:

```ini
[Unit]
Description=MT5 Trading Engine
After=network.target

[Service]
Type=simple
User=elise
WorkingDirectory=/home/elise/mt5-engine/engine
Environment="PATH=/home/elise/mt5-engine/engine/.venv/bin"
EnvironmentFile=/home/elise/mt5-engine/engine/.env
ExecStart=/home/elise/mt5-engine/engine/.venv/bin/python src/mt5_engine/__main__.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Activer le service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mt5-engine
sudo systemctl start mt5-engine
```

## 🔍 Vérification

### Vérifier que le service tourne

```bash
sudo systemctl status mt5-engine
```

### Vérifier les logs

```bash
sudo journalctl -u mt5-engine -f
```

Ou consulter les logs du moteur:

```bash
tail -f /home/elise/mt5-engine/engine/logs/engine.log
```

### Vérifier la connexion Wine

```bash
# Tester que MT5 peut être lancé via Wine
export WINEPREFIX=/home/elise/.wine-mt5
wine "C:\Program Files\MetaTrader 5\terminal64.exe"
```

## ⚠️ Notes importantes sur Wine

### Limitations de MetaTrader5 sur Wine

1. **Bibliothèque Python MetaTrader5**: La bibliothèque officielle MetaTrader5 pour Python ne fonctionne que sur Windows natif. Sur Linux avec Wine, vous devrez:
   - Exécuter Python via Wine
   - Ou utiliser une bibliothèque alternative
   - Ou créer un pont entre Linux et une VM Windows

2. **Stabilité**: MT5 via Wine peut être moins stable que sur Windows natif

3. **Performance**: L'exécution via Wine peut avoir des impacts sur les performances

### Alternative recommandée

Pour une production fiable, il est recommandé d'utiliser:
- Un VPS Windows dédié (Contabo offre des VPS Windows)
- Ou une VM Windows sur le VPS Linux
- Ou un service spécialisé dans le trading MT5

## 🔒 Configuration du Firewall

```bash
# Autoriser les connexions sortantes HTTPS
sudo ufw allow out 443/tcp

# Bloquer les connexions entrantes non nécessaires
sudo ufw default deny incoming
sudo ufw allow 22/tcp  # SSH
sudo ufw enable
```

## 📊 Monitoring

### Monitoring basique avec systemd

```bash
# Logs en temps réel
sudo journalctl -u mt5-engine -f

# Statut du service
sudo systemctl status mt5-engine
```

### Monitoring avancé

Considérez d'installer:
- **htop** - Pour l'utilisation CPU/RAM
- **iotop** - Pour l'I/O disque
- **Prometheus + Grafana** - Pour des métriques avancées

## 🐛 Dépannage

### Le service ne démarre pas

```bash
# Vérifier les logs systemd
sudo journalctl -u mt5-engine -n 50

# Tester manuellement
cd /home/elise/mt5-engine/engine
source .venv/bin/activate
python src/mt5_engine/__main__.py
```

### MetaTrader5 ne se connecte pas via Wine

- Vérifiez que Wine est correctement configuré
- Vérifiez que MT5 est installé dans le bon préfixe Wine
- Testez MT5 manuellement via Wine

### Erreur Python ModuleNotFoundError

```bash
cd /home/elise/mt5-engine/engine
source .venv/bin/activate
pip install -r requirements.txt
```

## 🔄 Mises à jour

### Mettre à jour le moteur

```bash
# Arrêter le service
sudo systemctl stop mt5-engine

# Mettre à jour le code (via Git ou copie)
cd /home/elise/mt5-engine
git pull  # ou copier les nouveaux fichiers

# Mettre à jour les dépendances
source .venv/bin/activate
pip install -r requirements.txt --upgrade

# Redémarrer le service
sudo systemctl start mt5-engine
```

## 📞 Support

En cas de problème:
1. Consultez les logs du moteur
2. Consultez les logs systemd
3. Vérifiez la configuration `.env`
4. Consultez la documentation Wine pour MT5

## 🚨 Sécurité

- ✅ N'exposez pas le VPS directement sur internet
- ✅ Utilisez des clés SSH fortes
- ✅ Gardez le système à jour (apt upgrade)
- ✅ Ne stockez pas de secrets en clair
- ✅ Utilisez un firewall strict
