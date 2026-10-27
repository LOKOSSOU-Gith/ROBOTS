#!/bin/bash
# Script d'installation automatique du moteur MT5 sur VPS Ubuntu avec Wine
# Ce script doit être exécuté sur le VPS Ubuntu

set -e

echo "=== Installation du moteur MT5 sur VPS Ubuntu ==="
echo ""

# Vérifier que Wine est installé
if ! command -v wine &> /dev/null; then
    echo "❌ ERREUR: Wine n'est pas installé"
    echo "   Installez Wine d'abord avec:"
    echo "   sudo dpkg --add-architecture i386"
    echo "   sudo apt update"
    echo "   sudo apt install -y wine64 wine32:i386 winbind xvfb xdotool wget unzip cabextract"
    exit 1
fi

echo "✅ Wine détecté"
wine --version

# Configuration
ENGINE_DIR="/home/elise/mt5-engine"
SETUP_DIR="/home/elise/mt5-setup"
PYTHON_VERSION="3.10"

echo ""
echo "📁 Création des répertoires..."
mkdir -p "$ENGINE_DIR"
mkdir -p "$SETUP_DIR"
mkdir -p "$ENGINE_DIR/logs"

# Vérifier si le code moteur existe
if [ -d "$SETUP_DIR/../engine" ]; then
    echo "✅ Copie du moteur depuis $SETUP_DIR/../engine vers $ENGINE_DIR"
    cp -r "$SETUP_DIR/../engine/"* "$ENGINE_DIR/"
else
    echo "⚠️  ATTENTION: Le dossier engine/ n'a pas été trouvé"
    echo "   Assurez-vous d'avoir copié le dossier engine/ depuis le repository"
    read -p "Continuer quand même? (o/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Oo]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "🐍 Installation de Python $PYTHON_VERSION..."

# Installer Python et pip
sudo apt update
sudo apt install -y python3 python3-venv python3-pip python3-dev

echo "✅ Python installé"
python3 --version

echo ""
echo "📦 Installation des dépendances Python..."

cd "$ENGINE_DIR"

# Créer l'environnement virtuel
echo "   Création de l'environnement virtuel..."
python3 -m venv .venv

# Activer l'environnement
source .venv/bin/activate

# Installer les dépendances
echo "   Installation des dépendances depuis requirements.txt..."
pip install --upgrade pip
pip install -r requirements.txt

echo "✅ Dépendances installées"

echo ""
echo "🍷 Configuration de Wine pour MT5..."

# Créer un préfixe Wine séparé pour MT5
WINE_PREFIX="/home/elise/.wine-mt5"
export WINEPREFIX

if [ ! -d "$WINE_PREFIX" ]; then
    echo "   Création du préfixe Wine pour MT5..."
    wineboot --init
fi

echo "✅ Wine configuré pour MT5"

echo ""
echo "📝 Configuration du service systemd..."

# Créer le fichier de service
cat <<EOF | sudo tee /etc/systemd/system/mt5-engine.service > /dev/null
[Unit]
Description=MT5 Trading Engine
After=network.target

[Service]
Type=simple
User=elise
WorkingDirectory=$ENGINE_DIR
Environment="PATH=$ENGINE_DIR/.venv/bin"
EnvironmentFile=$ENGINE_DIR/.env
ExecStart=$ENGINE_DIR/.venv/bin/python src/mt5_engine/__main__.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Créer le fichier .env par défaut
if [ ! -f "$ENGINE_DIR/.env" ]; then
    echo "   Création du fichier .env par défaut..."
    cat <<EOF > "$ENGINE_DIR/.env"
# Backend
BACKEND_URL=https://votre-domaine.vercel.app
ENGINE_AUTH_SECRET=CHANGEZ-CECI-32-CARACTERES-MINIMUM
ENGINE_SERVICE_ID=contabo-engine-01

# MT5 (Wine)
MT5_PATH=$WINE_PREFIX/drive_c/Program Files/MetaTrader 5/terminal64.exe
MT5_CONFIG_PATH=$WINE_PREFIX/drive_c/Program Files/MetaTrader 5

# Logs
LOG_LEVEL=info
EOF
    
    echo "   ⚠️  IMPORTANT: Éditez $ENGINE_DIR/.env et configurez BACKEND_URL et ENGINE_AUTH_SECRET"
fi

# Recharger systemd
sudo systemctl daemon-reload

echo "✅ Service systemd configuré"

echo ""
echo "🔥 Démarrage du service..."

sudo systemctl enable mt5-engine
sudo systemctl start mt5-engine

echo "✅ Service démarré"

echo ""
echo "=== Installation terminée ==="
echo ""
echo "Étapes suivantes:"
echo "1. Installer MetaTrader 5 via Wine:"
echo "   cd /home/elise/mt5-mt5"
echo "   wget <URL_DE_VOTRE_BROKER>/mt5setup.exe"
echo "   export WINEPREFIX=/home/elise/.wine-mt5"
echo "   wine mt5setup.exe"
echo ""
echo "2. Éditez $ENGINE_DIR/.env et configurez:"
echo "   - BACKEND_URL (URL de votre Vercel app)"
echo "   - ENGINE_AUTH_SECRET (secret partagé avec Vercel)"
echo "   - MT5_PATH (chemin vers MT5 dans Wine)"
echo ""
echo "3. Redémarrez le service:"
echo "   sudo systemctl restart mt5-engine"
echo ""
echo "4. Vérifiez les logs:"
echo "   sudo journalctl -u mt5-engine -f"
echo "   ou"
echo "   tail -f $ENGINE_DIR/logs/engine.log"
echo ""
echo "5. Vérifiez le statut:"
echo "   sudo systemctl status mt5-engine"
echo ""
