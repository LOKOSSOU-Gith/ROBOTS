#!/bin/bash

# Script de déploiement sur VPS Ubuntu existant
# Usage: bash deploy-ubuntu-existing.sh

set -e

echo "=========================================="
echo "MT5 Platform - Déploiement sur VPS existant"
echo "=========================================="

# Vérifier les prérequis
if ! command -v docker &> /dev/null; then
    echo "❌ Docker n'est pas installé. Veuillez l'installer d'abord."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé. Veuillez l'installer d'abord."
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 n'est pas installé. Veuillez l'installer d'abord."
    exit 1
fi

# ============================================
# 1. Cloner/mettre à jour le projet
# ============================================
echo ""
echo "[1/6] Clonage/mise à jour du projet..."

INSTALL_DIR="/opt/mt5-platform"
if [ -d "$INSTALL_DIR" ]; then
    echo "Mise à jour du projet existant..."
    cd $INSTALL_DIR
    git pull
else
    echo "Clonage du repository..."
    read -p "URL du repository Git: " REPO_URL
    git clone $REPO_URL $INSTALL_DIR
    cd $INSTALL_DIR
fi

# ============================================
# 2. Installer les dépendances Next.js
# ============================================
echo ""
echo "[2/6] Installation des dépendances Next.js..."
npm install

# ============================================
# 3. Configurer .env
# ============================================
echo ""
echo "[3/6] Configuration des variables d'environnement..."

if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Fichier .env créé. Veuillez le configurer manuellement:"
    echo ""
    echo "Variables minimales requises:"
    echo "  DATABASE_URL=file:./db.sqlite"
    echo "  DATABASE_URL_DIRECT=file:./db.sqlite"
    echo "  AUTH_SECRET=<générer: openssl rand -base64 48>"
    echo "  ENCRYPTION_KEY_RING=<générer: node -e \"console.log(JSON.stringify({'1':require('crypto').randomBytes(32).toString('base64')}))\">"
    echo "  ENGINE_AUTH_SECRET=<générer: openssl rand -base64 48>"
    echo "  ADMIN_EMAIL=votre@email.com"
    echo "  ADMIN_PASSWORD=votre_mot_de_passe"
    echo ""
    read -p "Appuyez sur Entrée après avoir configuré .env..."
fi

# ============================================
# 4. Initialiser la base de données
# ============================================
echo ""
echo "[4/6] Initialisation de la base de données..."
npm run db:generate
npm run db:migrate
npm run db:seed

# ============================================
# 5. Configurer mt5-gateway
# ============================================
echo ""
echo "[5/6] Configuration de mt5-gateway..."

cd engine/docker
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Fichier engine/docker/.env créé. Veuillez le configurer:"
    echo ""
    echo "Variables MT5 requises:"
    echo "  MT5_LOGIN=12345678"
    echo "  MT5_PASSWORD=votre_mot_de_passe"
    echo "  MT5_SERVER=ICMarketsSC-Demo"
    echo "  MT5_GATEWAY_API_KEY=<générer: openssl rand -base64 32>"
    echo ""
    read -p "Appuyez sur Entrée après avoir configuré .env..."
fi

# Démarrer mt5-gateway
docker compose up -d --build

echo "⏳ Attente de mt5-gateway (90 secondes)..."
sleep 90

# Vérifier
if curl -fsS http://localhost:5001/health/live > /dev/null; then
    echo "✅ mt5-gateway démarré avec succès"
else
    echo "❌ mt5-gateway n'a pas démarré. Vérifiez les logs:"
    echo "   cd /opt/mt5-platform/engine/docker && docker compose logs mt5-gateway"
    exit 1
fi

# ============================================
# 6. Configurer le moteur Python
# ============================================
echo ""
echo "[6/6] Configuration du moteur Python..."

cd /opt/mt5-platform/engine

# Créer l'environnement virtuel
if [ ! -d .venv ]; then
    python3 -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt

# Créer .env
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Fichier engine/.env créé. Veuillez le configurer:"
    echo ""
    echo "Variables requises:"
    echo "  BACKEND_URL=http://localhost:3000"
    echo "  ENGINE_AUTH_SECRET=<même valeur que dans .env racine>"
    echo "  TERMINAL_KIND=mt5_gateway"
    echo "  MT5_BRIDGE_URL=http://localhost:5001"
    echo "  MT5_GATEWAY_API_KEY=<même valeur que dans docker/.env>"
    echo ""
    read -p "Appuyez sur Entrée après avoir configuré .env..."
fi

# Créer le service systemd
if [ ! -f /etc/systemd/system/mt5-engine.service ]; then
    CURRENT_USER=$(whoami)
    cat > /etc/systemd/system/mt5-engine.service <<EOF
[Unit]
Description=MT5 Trading Engine
After=network.target docker.service

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=/opt/mt5-platform/engine
Environment="PATH=/opt/mt5-platform/engine/.venv/bin"
EnvironmentFile=/opt/mt5-platform/engine/.env
ExecStart=/opt/mt5-platform/engine/.venv/bin/python -m mt5_engine
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable mt5-engine
fi

sudo systemctl restart mt5-engine

echo "✅ Moteur Python démarré"

# ============================================
# 7. Déployer Next.js
# ============================================
echo ""
echo "[7/7] Déploiement de Next.js..."

cd /opt/mt5-platform
npm run build

# Installer pm2 si nécessaire
if ! command -v pm2 &> /dev/null; then
    echo "Installation de pm2..."
    sudo npm install -g pm2
fi

# Démarrer avec pm2
pm2 stop mt5-platform 2>/dev/null || true
pm2 delete mt5-platform 2>/dev/null || true
pm2 start npm --name "mt5-platform" -- start
pm2 save

echo "✅ Next.js démarré avec pm2"

# ============================================
# Configuration nginx (optionnel)
# ============================================
echo ""
read -p "Configurer nginx ? (y/n): " CONFIG_NGINX

if [ "$CONFIG_NGINX" = "y" ]; then
    if ! command -v nginx &> /dev/null; then
        echo "Installation de nginx..."
        sudo apt install -y nginx
    fi

    read -p "Avez-vous un domaine ? (y/n): " HAS_DOMAIN

    if [ "$HAS_DOMAIN" = "y" ]; then
        read -p "Nom de domaine: " DOMAIN_NAME

        sudo cat > /etc/nginx/sites-available/mt5-platform <<EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

        sudo ln -sf /etc/nginx/sites-available/mt5-platform /etc/nginx/sites-enabled/
        sudo nginx -t
        sudo systemctl reload nginx

        echo "Configuration HTTPS avec Certbot ? (y/n): "
        read CONFIG_HTTPS
        if [ "$CONFIG_HTTPS" = "y" ]; then
            sudo apt install -y certbot python3-certbot-nginx
            sudo certbot --nginx -d $DOMAIN_NAME
        fi
    else
        IP=$(hostname -I | awk '{print $1}')
        sudo cat > /etc/nginx/sites-available/mt5-platform <<EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

        sudo ln -sf /etc/nginx/sites-available/mt5-platform /etc/nginx/sites-enabled/
        sudo nginx -t
        sudo systemctl reload nginx

        echo "✅ Nginx configuré: http://$IP"
    fi
fi

# ============================================
# Résumé
# ============================================
echo ""
echo "=========================================="
echo "Déploiement terminé !"
echo "=========================================="
echo ""
echo "Services actifs:"
echo "  ✅ mt5-gateway (Docker)"
echo "  ✅ Moteur Python (systemd)"
echo "  ✅ Next.js (pm2)"
if [ "$CONFIG_NGINX" = "y" ]; then
    echo "  ✅ Nginx"
fi
echo ""
echo "Logs:"
echo "  - Next.js: pm2 logs mt5-platform"
echo "  - Moteur: sudo journalctl -u mt5-engine -f"
echo "  - mt5-gateway: cd /opt/mt5-platform/engine/docker && docker compose logs -f"
echo ""
echo "URL d'accès:"
if [ "$HAS_DOMAIN" = "y" ] && [ "$CONFIG_HTTPS" = "y" ]; then
    echo "  https://$DOMAIN_NAME"
elif [ "$HAS_DOMAIN" = "y" ]; then
    echo "  http://$DOMAIN_NAME"
else
    echo "  http://$(hostname -I | awk '{print $1}'):3000"
fi
echo ""
