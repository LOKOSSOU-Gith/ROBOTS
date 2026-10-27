# Scripts de déploiement automatisé

Ce dossier contient des scripts pour automatiser le déploiement de la plateforme MT5 sur Ubuntu.

## Scripts disponibles

### 1. `deploy-ubuntu.sh` - Installation complète sur nouveau VPS

Ce script installe TOUT depuis zéro sur un nouveau VPS Ubuntu:

- ✅ Mise à jour du système
- ✅ Installation de Docker & Docker Compose
- ✅ Installation de Node.js 18
- ✅ Installation de Python 3
- ✅ Installation de pm2
- ✅ Installation de nginx + certbot
- ✅ Clonage du projet
- ✅ Configuration Next.js
- ✅ Initialisation de la base de données
- ✅ Déploiement de mt5-gateway (Docker)
- ✅ Configuration du moteur Python (systemd)
- ✅ Déploiement Next.js (pm2)
- ✅ Configuration nginx + HTTPS

**Utilisation:**

```bash
# Sur le VPS Ubuntu
sudo bash deploy-ubuntu.sh
```

**Prérequis:**
- Accès root ou sudo
- ~2-3 Go d'espace disque libre
- Connexion internet

**Note:** Le script vous demandera de configurer manuellement les fichiers `.env` à chaque étape.

---

### 2. `deploy-ubuntu-existing.sh` - Déploiement sur VPS existant

Ce script déploie sur un VPS Ubuntu où Docker, Node.js et Python sont déjà installés:

- ✅ Clonage/mise à jour du projet
- ✅ Installation des dépendances Next.js
- ✅ Configuration des variables d'environnement
- ✅ Initialisation de la base de données
- ✅ Déploiement de mt5-gateway
- ✅ Configuration du moteur Python
- ✅ Déploiement Next.js (pm2)
- ✅ Configuration nginx (optionnel)

**Utilisation:**

```bash
# Sur le VPS Ubuntu
bash deploy-ubuntu-existing.sh
```

**Prérequis:**
- Docker installé
- Node.js 18+ installé
- Python 3.10+ installé
- Accès sudo pour systemd

---

## Configuration requise

Avant d'exécuter les scripts, préparez vos valeurs:

### Backend (.env à la racine)

```bash
# Générez ces secrets:
AUTH_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY_RING=$(node -e "console.log(JSON.stringify({'1':require('crypto').randomBytes(32).toString('base64')}))")
ENGINE_AUTH_SECRET=$(openssl rand -base64 48)

# Vos valeurs:
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=votre_mot_de_passe sécurisé
```

### mt5-gateway (engine/docker/.env)

```bash
# Générez:
MT5_GATEWAY_API_KEY=$(openssl rand -base64 32)

# Vos credentials MT5:
MT5_LOGIN=12345678
MT5_PASSWORD=votre_mot_de_passe_mt5
MT5_SERVER=ICMarketsSC-Demo
```

### Moteur Python (engine/.env)

```bash
# Ces valeurs doivent correspondre:
BACKEND_URL=http://localhost:3000
ENGINE_AUTH_SECRET=<même valeur que .env racine>
TERMINAL_KIND=mt5_gateway
MT5_BRIDGE_URL=http://localhost:5001
MT5_GATEWAY_API_KEY=<même valeur que docker/.env>
```

---

## Déploiement manuel (si les scripts échouent)

Si vous préférez un déploiement manuel ou si les scripts échouent, suivez le guide détaillé:

📖 [DEPLOYMENT_UBUNTU.md](./DEPLOYMENT_UBUNTU.md)

---

## Vérification après déploiement

### Vérifier tous les services

```bash
# mt5-gateway
curl http://localhost:5001/health/live

# Moteur Python
sudo systemctl status mt5-engine

# Next.js
pm2 status mt5-platform

# Nginx
sudo systemctl status nginx
```

### Voir les logs

```bash
# Next.js
pm2 logs mt5-platform

# Moteur Python
sudo journalctl -u mt5-engine -f

# mt5-gateway
cd /opt/mt5-platform/engine/docker
docker compose logs -f mt5-gateway
```

---

## Gestion des services

### Redémarrer les services

```bash
# Next.js
pm2 restart mt5-platform

# Moteur Python
sudo systemctl restart mt5-engine

# mt5-gateway
cd /opt/mt5-platform/engine/docker
docker compose restart
```

### Arrêter les services

```bash
# Next.js
pm2 stop mt5-platform

# Moteur Python
sudo systemctl stop mt5-engine

# mt5-gateway
cd /opt/mt5-platform/engine/docker
docker compose down
```

---

## Mises à jour

Pour mettre à jour le code après le déploiement initial:

```bash
cd /opt/mt5-platform
git pull

# Next.js
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

---

## Dépannage

### mt5-gateway ne démarre pas

```bash
cd /opt/mt5-platform/engine/docker
docker compose logs mt5-gateway

# Vérifier que Docker tourne
sudo systemctl status docker

# Recréer le conteneur
docker compose down
docker compose up -d --build
```

### Le moteur ne se connecte pas à mt5-gateway

```bash
# Vérifier que mt5-gateway est prêt
curl http://localhost:5001/health/ready

# Vérifier la configuration
cat /opt/mt5-platform/engine/.env

# Vérifier les logs du moteur
sudo journalctl -u mt5-engine -n 100
```

### Next.js ne démarre pas

```bash
pm2 logs mt5-platform

# Vérifier le port
netstat -tlnp | grep 3000

# Rebuilder
cd /opt/mt5-platform
npm run build
pm2 restart mt5-platform
```

---

## Sécurité

Après le déploiement:

1. ✅ Configurez le firewall UFW:
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

2. ✅ Ne jamais exposer le port 5001 (mt5-gateway) sur internet

3. ✅ Utilisez des mots de passe forts pour les API keys

4. ✅ Gardez le système à jour:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

5. ✅ Activez HTTPS avec certbot (inclus dans les scripts)

---

## Support

En cas de problème:

1. Consultez les logs de chaque composant
2. Vérifiez la configuration `.env`
3. Consultez [DEPLOYMENT_UBUNTU.md](./DEPLOYMENT_UBUNTU.md)
4. Consultez la documentation mt5-gateway: https://mt5.tryqkt.com/
