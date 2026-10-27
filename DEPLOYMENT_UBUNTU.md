# Guide de déploiement - MT5 SaaS Platform (Ubuntu + Docker + mt5-gateway)

Ce guide couvre le déploiement de la plateforme sur un VPS Ubuntu avec mt5-gateway (MT5 sous Wine/Docker).

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│  VPS Ubuntu (50GB)                      │
│  - Next.js Backend (port 3000)          │
│  - SQLite Database                      │
│  - Moteur Python (service systemd)      │
│  - mt5-gateway (Docker, port 5001)     │
│  - MT5 sous Wine                        │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Broker Servers                         │
└─────────────────────────────────────────┘
```

## 📦 Prérequis

### Logiciels à installer sur le VPS Ubuntu

- Node.js >= 18.18.0
- Python 3.10+
- Docker & Docker Compose
- Git
- pm2 (pour Next.js)
- systemd (pour le moteur Python)

## 🚀 Étape 1: Préparer le VPS Ubuntu

### 1.1 Mise à jour du système

```bash
sudo apt update && sudo apt upgrade -y
```

### 1.2 Installer Docker

```bash
# Installer Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Ajouter l'utilisateur au groupe docker
sudo usermod -aG docker $USER

# Installer Docker Compose
sudo apt install docker-compose-plugin -y

# Vérifier l'installation
docker --version
docker compose version
```

### 1.3 Installer Node.js

```bash
# Installer Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Vérifier
node --version
npm --version
```

### 1.4 Installer Python 3.10+

```bash
sudo apt install python3 python3-pip python3-venv -y

# Vérifier
python3 --version
```

### 1.5 Installer pm2

```bash
sudo npm install -g pm2
```

## 📂 Étape 2: Cloner et configurer le projet

### 2.1 Cloner le repository

```bash
cd /opt
sudo git clone <votre-repo-url> mt5-platform
cd mt5-platform
```

### 2.2 Installer les dépendances Next.js

```bash
npm install
```

### 2.3 Configurer les variables d'environnement

```bash
cp .env.example .env
nano .env
```

Remplir les variables:

```env
# Database (SQLite local)
DATABASE_URL=file:./db.sqlite
DATABASE_URL_DIRECT=file:./db.sqlite
DATABASE_POOL_MAX=5

# Authentification
AUTH_SECRET=<générer avec: openssl rand -base64 48>
SESSION_COOKIE_NAME=mt5_session
SESSION_TTL_SECONDS=86400
ALLOWED_ORIGINS=http://localhost:3000,http://votre-ip:3000

# Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<mot de passe sécurisé>

# Chiffrement
ENCRYPTION_KEY_RING=<générer avec: node -e "console.log(JSON.stringify({'1':require('crypto').randomBytes(32).toString('base64')}))">
SECRET_KEY_ROTATION_DAYS=90

# Backend ↔ Moteur
ENGINE_SERVICE_ID=ubuntu-engine-01
ENGINE_AUTH_SECRET=<générer avec: openssl rand -base64 48>
COMMAND_TTL_SECONDS=120
ENGINE_HEARTBEAT_SECONDS=15

# Mode réel
ALLOW_REAL_ACCOUNTS=false

# Application
APP_ENV=production
LOG_LEVEL=info
```

### 2.4 Initialiser la base de données

```bash
# Générer les migrations
npm run db:generate

# Appliquer les migrations
npm run db:migrate

# Créer l'admin
npm run db:seed
```

## 🐳 Étape 3: Déployer mt5-gateway

### 3.1 Configurer mt5-gateway

```bash
cd engine/docker
cp .env.example .env
nano .env
```

Remplir avec vos credentials MT5:

```env
MT5_LOGIN=12345678
MT5_PASSWORD=votre_mot_de_passe
MT5_SERVER=ICMarketsSC-Demo
MT5_GATEWAY_API_KEY=<générer avec: openssl rand -base64 32>
```

### 3.2 Démarrer mt5-gateway

```bash
docker compose up -d --build
```

### 3.3 Vérifier que mt5-gateway est prêt

```bash
# Attendre ~90 secondes (start_period)
# Puis vérifier
curl -H "Authorization: Bearer $MT5_GATEWAY_API_KEY" http://localhost:5001/health/ready

# Doit retourner: {"status":"ready"}
```

Si ce n'est pas prêt, consultez les logs:

```bash
docker compose logs -f mt5-gateway
```

## 🚀 Étape 4: Déployer le moteur Python

### 4.1 Créer l'environnement virtuel

```bash
cd /opt/mt5-platform/engine
python3 -m venv .venv
source .venv/bin/activate
```

### 4.2 Installer les dépendances

```bash
pip install -r requirements.txt
```

### 4.3 Configurer le moteur

Créer `.env` dans `engine/`:

```env
# Backend
BACKEND_URL=http://localhost:3000
ENGINE_AUTH_SECRET=<même valeur que dans .env racine>
ENGINE_SERVICE_ID=ubuntu-engine-01

# Terminal
TERMINAL_KIND=mt5_gateway
MT5_BRIDGE_URL=http://localhost:5001
MT5_GATEWAY_API_KEY=<même valeur que dans docker/.env>

# Logs
LOG_LEVEL=info
ENGINE_STATE_DIR=/opt/mt5-platform/engine-state
```

### 4.4 Créer le service systemd

Créer `/etc/systemd/system/mt5-engine.service`:

```ini
[Unit]
Description=MT5 Trading Engine
After=network.target docker.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/mt5-platform/engine
Environment="PATH=/opt/mt5-platform/engine/.venv/bin"
EnvironmentFile=/opt/mt5-platform/engine/.env
ExecStart=/opt/mt5-platform/engine/.venv/bin/python -m mt5_engine
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Activer et démarrer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mt5-engine
sudo systemctl start mt5-engine

# Vérifier
sudo systemctl status mt5-engine
```

## 🌐 Étape 5: Déployer Next.js avec pm2

### 5.1 Builder l'application

```bash
cd /opt/mt5-platform
npm run build
```

### 5.2 Démarrer avec pm2

```bash
pm2 start npm --name "mt5-platform" -- start
pm2 save
pm2 startup
```

### 5.3 Configurer nginx (optionnel mais recommandé)

Si vous voulez un domaine et HTTPS:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Créer `/etc/nginx/sites-available/mt5-platform`:

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Activer:

```bash
sudo ln -s /etc/nginx/sites-available/mt5-platform /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Certbot pour HTTPS
sudo certbot --nginx -d votre-domaine.com
```

## ✅ Étape 6: Vérification

### 6.1 Vérifier mt5-gateway

```bash
curl -H "Authorization: Bearer $MT5_GATEWAY_API_KEY" http://localhost:5001/health
```

### 6.2 Vérifier le moteur

```bash
sudo systemctl status mt5-engine
sudo journalctl -u mt5-engine -f
```

### 6.3 Vérifier Next.js

```bash
pm2 status
curl http://localhost:3000/api/v1/health
```

### 6.4 Vérifier la communication complète

Depuis le backend:

```bash
# Le moteur devrait envoyer un heartbeat toutes les 15s
# Vérifiez les logs du moteur pour voir les heartbeats
```

## 🔧 Gestion des comptes MT5

### IMPORTANT: Un compte par instance de mt5-gateway

mt5-gateway ne gère qu'un seul compte MT5 par conteneur. Pour plusieurs comptes:

**Option 1: Plusieurs conteneurs mt5-gateway**

Modifiez `docker-compose.yml` pour plusieurs services:

```yaml
services:
  mt5-gateway-account1:
    image: elitekaycy/mt5-gateway-api:0.3.21
    environment:
      MT5_LOGIN: ${MT5_LOGIN_1}
      MT5_PASSWORD: ${MT5_PASSWORD_1}
      MT5_SERVER: ${MT5_SERVER_1}
      API_KEY: ${MT5_GATEWAY_API_KEY_1}
    ports:
      - "5001:5001"

  mt5-gateway-account2:
    image: elitekaycy/mt5-gateway-api:0.3.21
    environment:
      MT5_LOGIN: ${MT5_LOGIN_2}
      MT5_PASSWORD: ${MT5_PASSWORD_2}
      MT5_SERVER: ${MT5_SERVER_2}
      API_KEY: ${MT5_GATEWAY_API_KEY_2}
    ports:
      - "5002:5001"
```

**Option 2: Redémarrer avec de nouveaux credentials**

Pour changer de compte:

```bash
cd engine/docker
nano .env  # Modifier MT5_LOGIN, MT5_PASSWORD, MT5_SERVER
docker compose down
docker compose up -d --build
```

## 🔄 Mises à jour

### Mise à jour du code

```bash
cd /opt/mt5-platform
git pull

# Backend
npm install
npm run build
pm2 restart mt5-platform

# Moteur
cd engine
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart mt5-engine

# mt5-gateway
cd docker
docker compose pull
docker compose up -d
```

### Migrations DB

```bash
cd /opt/mt5-platform
npm run db:generate
npm run db:migrate
```

## 📊 Monitoring

### Logs

```bash
# Next.js
pm2 logs mt5-platform

# Moteur
sudo journalctl -u mt5-engine -f

# mt5-gateway
cd /opt/mt5-platform/engine/docker
docker compose logs -f mt5-gateway
```

### Métriques système

```bash
htop
df -h
docker stats
```

## 🚨 Dépannage

### mt5-gateway ne démarre pas

```bash
# Vérifier les logs
docker compose logs mt5-gateway

# Vérifier que Docker tourne
sudo systemctl status docker

# Vérifier les credentials
docker compose config
```

### Le moteur ne se connecte pas à mt5-gateway

```bash
# Vérifier que mt5-gateway est prêt
curl -H "Authorization: Bearer $MT5_GATEWAY_API_KEY" http://localhost:5001/health/ready

# Vérifier la configuration du moteur
cat /opt/mt5-platform/engine/.env

# Vérifier les logs du moteur
sudo journalctl -u mt5-engine -n 100
```

### MT5 ne se connecte pas au broker

- Vérifiez que les credentials MT5 sont corrects
- Vérifiez que le nom du serveur est exact
- Consultez les logs mt5-gateway pour les erreurs de connexion

### Next.js ne démarre pas

```bash
# Vérifier les logs
pm2 logs mt5-platform

# Vérifier le port
netstat -tlnp | grep 3000

# Rebuilder
npm run build
pm2 restart mt5-platform
```

## 🔒 Sécurité

- ✅ Ne jamais exposer le port 5001 de mt5-gateway sur internet
- ✅ Utiliser des mots de passe forts pour les API keys
- ✅ Garder le système à jour (`sudo apt update && sudo apt upgrade`)
- ✅ Configurer le firewall UFW:
  ```bash
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw enable
  ```
- ✅ Utiliser HTTPS en production avec nginx + certbot

## 📞 Support

En cas de problème:
1. Consultez les logs de chaque composant
2. Vérifiez la configuration `.env`
3. Consultez la documentation mt5-gateway: https://mt5.tryqkt.com/
