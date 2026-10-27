#!/bin/bash

# Script d'automatisation du déploiement MT5 Platform sur Ubuntu
# Usage: sudo bash deploy-ubuntu.sh

set -e  # Arrêter en cas d'erreur

echo "=========================================="
echo "MT5 Platform - Déploiement Ubuntu"
echo "=========================================="

# Vérifier que le script est exécuté en root
if [ "$EUID" -ne 0 ]; then
    echo "Veuillez exécuter ce script avec sudo: sudo bash deploy-ubuntu.sh"
    exit 1
fi

# ============================================
# 1. Mise à jour du système
# ============================================
echo ""
echo "[1/9] Mise à jour du système..."
apt update && apt upgrade -y

# ============================================
# 2. Installation des dépendances
# ============================================
echo ""
echo "[2/9] Installation des dépendances..."

# Installer Docker
if ! command -v docker &> /dev/null; then
    echo "Installation de Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $SUDO_USER
else
    echo "Docker déjà installé"
fi

# Installer Docker Compose
if ! command -v docker &> /dev/null || ! docker compose version &> /dev/null; then
    echo "Installation de Docker Compose..."
    apt install docker-compose-plugin -y
else
    echo "Docker Compose déjà installé"
fi

# Installer Node.js 18
if ! command -v node &> /dev/null; then
    echo "Installation de Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
else
    echo "Node.js déjà installé: $(node --version)"
fi

# Installer Python 3
if ! command -v python3 &> /dev/null; then
    echo "Installation de Python 3..."
    apt install -y python3 python3-pip python3-venv
else
    echo "Python déjà installé: $(python3 --version)"
fi

# Installer pm2
if ! command -v pm2 &> /dev/null; then
    echo "Installation de pm2..."
    npm install -g pm2
else
    echo "pm2 déjà installé"
fi

# Installer nginx (optionnel)
apt install -y nginx certbot python3-certbot-nginx

# ============================================
# 3. Cloner le projet
# ============================================
echo ""
echo "[3/9] Clonage du projet..."

INSTALL_DIR="/opt/mt5-platform"
if [ -d "$INSTALL_DIR" ]; then
    echo "Le répertoire existe déjà, mise à jour..."
    cd $INSTALL_DIR
    git pull
else
    echo "Clonage du repository..."
    read -p "URL du repository Git: " REPO_URL
    git clone $REPO_URL $INSTALL_DIR
    cd $INSTALL_DIR
fi

# ============================================
# 4. Configurer Next.js
# ============================================
echo ""
echo "[4/9] Configuration de Next.js..."

npm install

# Créer .env si inexistant
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Fichier .env créé. Veuillez le configurer manuellement."
    echo "Variables requises:"
    echo "  - DATABASE_URL=file:./db.sqlite"
    echo "  - AUTH_SECRET (générer avec: openssl rand -base64 48)"
    echo "  - ENCRYPTION_KEY_RING (générer avec: node -e \"console.log(JSON.stringify({'1':require('crypto').randomBytes(32).toString('base64')}))\")"
    echo "  - ENGINE_AUTH_SECRET (générer avec: openssl rand -base64 48)"
    echo "  - ADMIN_EMAIL"
    echo "  - ADMIN_PASSWORD"
    read -p "Appuyez sur Entrée après avoir configuré .env..."
fi

# ============================================
# 5. Initialiser la base de données
# ============================================
echo ""
echo "[5/9] Initialisation de la base de données..."

npm run db:generate
npm run db:migrate
npm run db:seed

# ============================================
# 6. Configurer mt5-gateway
# ============================================
echo ""
echo "[6/9] Configuration de mt5-gateway..."

cd engine/docker
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Fichier engine/docker/.env créé. Veuillez le configurer avec vos credentials MT5:"
    echo "  - MT5_LOGIN"
    echo "  - MT5_PASSWORD"
    echo "  - MT5_SERVER"
    echo "  - MT5_GATEWAY_API_KEY (générer avec: openssl rand -base64 32)"
    read -p "Appuyez sur Entrée après avoir configuré .env..."
fi

# Démarrer mt5-gateway
docker compose up -d --build

echo "Attente de mt5-gateway (90 secondes)..."
sleep 90

# Vérifier que mt5-gateway est prêt
if curl -fsS http://localhost:5001/health/live > /dev/null; then
    echo "✅ mt5-gateway est en cours d'exécution"
else
    echo "❌ mt5-gateway n'a pas démarré correctement"
    docker compose logs mt5-gateway
    exit 1
fi

# ============================================
# 7. Configurer le moteur Python
# ============================================
echo ""
echo "[7/9] Configuration du moteur Python..."

cd /opt/mt5-platform/engine

# Créer l'environnement virtuel
if [ ! -d .venv ]; then
    python3 -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt

# Créer .env si inexistant
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Fichier engine/.env créé. Veuillez le configurer:"
    echo "  - BACKEND_URL=http://localhost:3000"
    echo "  - ENGINE_AUTH_SECRET (même valeur que dans .env racine)"
    echo "  - TERMINAL_KIND=mt5_gateway"
    echo "  - MT5_BRIDGE_URL=http://localhost:5001"
    echo "  - MT5_GATEWAY_API_KEY (même valeur que dans docker/.env)"
    read -p "Appuyez sur Entrée après avoir configuré .env..."
fi

# Créer le service systemd
cat > /etc/systemd/system/mt5-engine.service <<EOF
[Unit]
Description=MT5 Trading Engine
After=network.target docker.service

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=/opt/mt5-platform/engine
Environment="PATH=/opt/mt5-platform/engine/.venv/bin"
EnvironmentFile=/opt/mt5-platform/engine/.env
ExecStart=/opt/mt5-platform/engine/.venv/bin/python -m mt5_engine
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mt5-engine
systemctl start mt5-engine

echo "✅ Moteur Python démarré"

# ============================================
# 8. Déployer Next.js avec pm2
# ============================================
echo ""
echo "[8/9] Déploiement de Next.js..."

cd /opt/mt5-platform
npm run build

# Arrêter pm2 si déjà en cours
pm2 stop mt5-platform 2>/dev/null || true
pm2 delete mt5-platform 2>/dev/null || true

pm2 start npm --name "mt5-platform" -- start
pm2 save
pm2 startup

echo "✅ Next.js démarré avec pm2"

# ============================================
# 9. Configuration nginx (optionnel)
# ============================================
echo ""
echo "[9/9] Configuration nginx..."

read -p "Avez-vous un domaine ? (y/n): " HAS_DOMAIN

if [ "$HAS_DOMAIN" = "y" ]; then
    read -p "Nom de domaine: " DOMAIN_NAME

    cat > /etc/nginx/sites-available/mt5-platform <<EOF
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

    ln -sf /etc/nginx/sites-available/mt5-platform /etc/nginx/sites-enabled/
    nginx -t
    systemctl reload nginx

    echo "Configuration HTTPS avec Certbot..."
    certbot --nginx -d $DOMAIN_NAME

    echo "✅ Nginx configuré avec HTTPS"
else
    echo "Configuration nginx par défaut (localhost)..."
    cat > /etc/nginx/sites-available/mt5-platform <<EOF
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

    ln -sf /etc/nginx/sites-available/mt5-platform /etc/nginx/sites-enabled/
    nginx -t
    systemctl reload nginx

    echo "✅ Nginx configuré (accessible via http://$(hostname -I | awk '{print $1}')")"
fi

# ============================================
# 10. Vérification finale
# ============================================
echo ""
echo "=========================================="
echo "Vérification finale"
echo "=========================================="

echo ""
echo "1. Vérification mt5-gateway:"
if curl -fsS http://localhost:5001/health/live > /dev/null; then
    echo "   ✅ mt5-gateway: OK"
else
    echo "   ❌ mt5-gateway: ERROR"
fi

echo ""
echo "2. Vérification moteur Python:"
if systemctl is-active --quiet mt5-engine; then
    echo "   ✅ Moteur Python: OK"
else
    echo "   ❌ Moteur Python: ERROR"
fi

echo ""
echo "3. Vérification Next.js:"
if pm2 status mt5-platform | grep -q "online"; then
    echo "   ✅ Next.js: OK"
else
    echo "   ❌ Next.js: ERROR"
fi

echo ""
echo "4. Vérification nginx:"
if systemctl is-active --quiet nginx; then
    echo "   ✅ Nginx: OK"
else
    echo "   ❌ Nginx: ERROR"
fi

# ============================================
# Fin
# ============================================
echo ""
echo "=========================================="
echo "Déploiement terminé !"
echo "=========================================="
echo ""
echo "URL d'accès:"
if [ "$HAS_DOMAIN" = "y" ]; then
    echo "  https://$DOMAIN_NAME"
else
    echo "  http://$(hostname -I | awk '{print $1}')"
fi
echo ""
echo "Logs utiles:"
echo "  - Next.js: pm2 logs mt5-platform"
echo "  - Moteur: journalctl -u mt5-engine -f"
echo "  - mt5-gateway: cd /opt/mt5-platform/engine/docker && docker compose logs -f"
echo ""
echo "Pour redémarrer les services:"
echo "  - Next.js: pm2 restart mt5-platform"
echo "  - Moteur: sudo systemctl restart mt5-engine"
echo "  - mt5-gateway: cd /opt/mt5-platform/engine/docker && docker compose restart"
echo ""
