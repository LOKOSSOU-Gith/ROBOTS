# Guide de déploiement - MT5 SaaS Platform

Ce document couvre le déploiement de la plateforme en production.

## 🏗️ Architecture de production

```
┌─────────────────────────────────────────┐
│         Vercel (Frontend + API)        │
│  - Next.js 15                           │
│  - PostgreSQL connection pool           │
│  - Environment variables                │
└──────────────┬──────────────────────────┘
               │ HTTPS
┌──────────────▼──────────────────────────┐
│         Neon (PostgreSQL)               │
│  - Base de données managée             │
│  - Branching pour preview              │
│  - Backups automatiques                 │
└──────────────┬──────────────────────────┘
               │ HTTPS (engine auth)
┌──────────────▼──────────────────────────┐
│    Contabo VPS (Moteur Python)         │
│  - Windows Server 2022                 │
│  - MT5 Terminal                        │
│  - Python Engine Service               │
│  - Windows Agent                       │
└─────────────────────────────────────────┘
```

## 📦 Prérequis

### Comptes et services

- **Vercel** - Pour le frontend et API
- **Neon** - Pour PostgreSQL
- **Contabo** - Pour le VPS Windows (nécessaire pour MT5)
- **Domaine** - Pour le frontend (optionnel mais recommandé)

### Outils locaux

- Node.js >= 18.18.0
- Git
- Accès SSH au VPS

## 🚀 Étape 1: Base de données (Neon)

### 1.1 Créer un projet Neon

1. Connectez-vous sur [console.neon.tech](https://console.neon.tech)
2. Créez un nouveau projet
3. Choisissez la région la plus proche de vos utilisateurs
4. Notez les informations de connexion

### 1.2 Configurer les variables d'environnement

Dans le dashboard Neon, récupérez:
- Connection string (poolée)
- Connection string directe (pour migrations)

Exemple:
```
DATABASE_URL=postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
DATABASE_URL_DIRECT=postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

### 1.3 Appliquer les migrations

Depuis votre machine locale:

```bash
# Configurez les variables temporaires
export DATABASE_URL="postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
export DATABASE_URL_DIRECT="postgres://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# Générez les migrations (si modifié)
npm run db:generate

# Appliquez les migrations
npm run db:migrate

# Seed la base (crée l'admin)
npm run db:seed
```

### 1.4 Configurer les connexions sortantes

Dans Neon, configurez:
- IP allowlist si nécessaire
- Connection pooling activé

## 🌐 Étape 2: Frontend (Vercel)

### 2.1 Connecter le repository

1. Connectez-vous sur [vercel.com](https://vercel.com)
2. "Add New Project"
3. Importez depuis GitHub
4. Sélectionnez le repository

### 2.2 Configurer le projet

#### Framework Preset
- Framework: Next.js
- Build Command: `npm run build`
- Output Directory: `.next`
- Install Command: `npm install`

#### Environment Variables

Ajoutez ces variables dans les settings Vercel:

| Variable | Description | Valeur |
|----------|-------------|--------|
| `DATABASE_URL` | Connection Neon poolée | `postgres://...` |
| `DATABASE_URL_DIRECT` | Connection Neon directe | `postgres://...` |
| `DATABASE_POOL_MAX` | Taille du pool | `5` |
| `AUTH_SECRET` | Secret sessions | `openssl rand -base64 48` |
| `SESSION_COOKIE_NAME` | Nom du cookie | `mt5_session` |
| `SESSION_TTL_SECONDS` | Durée session | `86400` |
| `ALLOWED_ORIGINS` | Origines autorisées | `https://votre-domaine.com` |
| `ENCRYPTION_KEY_RING` | Clés AES-256 | Voir section Clés |
| `SECRET_KEY_ROTATION_DAYS` | Rotation clés | `90` |
| `ENGINE_AUTH_SECRET` | Secret moteur | Voir section Moteur |
| `COMMAND_TTL_SECONDS` | TTL commandes | `120` |
| `ENGINE_HEARTBEAT_SECONDS` | Heartbeat moteur | `15` |
| `ALLOW_REAL_ACCOUNTS` | Comptes réels | `false` (défaut) |
| `APP_ENV` | Environnement | `production` |
| `LOG_LEVEL` | Niveau de logs | `info` |

#### Génération des clés

**AUTH_SECRET:**
```bash
openssl rand -base64 48
```

**ENCRYPTION_KEY_RING:**
```bash
node -e "console.log(JSON.stringify({'1':require('crypto').randomBytes(32).toString('base64')}))"
```

**ENGINE_AUTH_SECRET:**
```bash
# 32+ caractères aléatoires, à partager avec le moteur
openssl rand -base64 48
```

### 2.3 Déployer

1. Cliquez sur "Deploy"
2. Attendez la fin du build
3. Notez l'URL générée (ex: `https://mt5-platform.vercel.app`)

### 2.4 Configurer le domaine (optionnel)

1. Dans Project Settings > Domains
2. Ajoutez votre domaine
3. Configurez le DNS selon les instructions Vercel
4. Attendez la validation SSL

### 2.5 Vérifier le déploiement

```bash
curl https://votre-domaine.com/api/v1/health
# Doit retourner: {"status":"ok"}
```

## 🖥️ Étape 3: Moteur Python (Contabo)

### 3.1 Provisionner le VPS

1. Connectez-vous sur [contabo.com](https://contabo.com)
2. Commandez un VPS Windows (Windows Server 2022 recommandé)
3. Choisissez au moins 4 vCPU, 8GB RAM
4. Attendez le déploiement (environ 1-2 heures)

### 3.2 Initialiser le VPS

Connectez-vous via RDP:

1. **Installer Node.js**
   - Téléchargez depuis [nodejs.org](https://nodejs.org)
   - Installez la version LTS (18+)

2. **Installer Python 3.10+**
   - Téléchargez depuis [python.org](https://python.org)
   - Cochez "Add Python to PATH"

3. **Installer MetaTrader 5**
   - Téléchargez depuis votre broker
   - Installez dans un chemin sans espaces (ex: `C:\MT5`)

4. **Cloner le moteur**
   ```powershell
   cd C:\
   git clone <repository-url> mt5-engine
   cd mt5-engine\engine
   ```

5. **Installer les dépendances Python**
   ```powershell
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

### 3.3 Configurer le moteur

Créez `C:\mt5-engine\engine\.env`:

```env
# Backend
BACKEND_URL=https://votre-domaine.com
ENGINE_AUTH_SECRET=<même valeur que sur Vercel>
ENGINE_SERVICE_ID=contabo-engine-01

# MT5
MT5_PATH=C:\MT5\terminal64.exe
MT5_CONFIG_PATH=C:\MT5\Config

# Logs
LOG_LEVEL=info
```

### 3.4 Configurer le Windows Agent

Le Windows Agent permet au moteur Python de communiquer avec MT5.

1. Copiez `engine/windows_agent/` vers `C:\mt5-windows-agent\`
2. Créez un service Windows pour l'agent:
   ```powershell
   sc create MT5Agent binPath= "C:\mt5-windows-agent\agent.exe" start= auto
   sc start MT5Agent
   ```

### 3.5 Déployer le moteur comme service Windows

Créez un fichier `install-service.ps1`:

```powershell
$nssm = "C:\nssm\nssm.exe"  # Téléchargez NSSM
$servicePath = "C:\mt5-engine\engine\.venv\Scripts\python.exe"
$scriptPath = "C:\mt5-engine\engine\src\mt5_engine\__main__.py"

& $nssm install MT5Engine $servicePath $scriptPath
& $nssm set MT5Engine AppDirectory "C:\mt5-engine\engine"
& $nssm set MT5Engine AppEnvironmentFile "C:\mt5-engine\engine\.env"
& $nssm start MT5Engine
```

Exécutez:
```powershell
powershell -ExecutionPolicy Bypass -File install-service.ps1
```

### 3.6 Vérifier le moteur

```powershell
# Vérifier que le service tourne
sc query MT5Engine

# Vérifier les logs
Get-Content C:\mt5-engine\engine\logs\engine.log -Tail 50
```

Le moteur devrait envoyer un heartbeat toutes les 15s au backend.

## 🔒 Étape 4: Sécurité

### 4.1 Firewall Windows

Configurez le firewall pour:
- Autoriser les connexions sortantes HTTPS (port 443)
- Bloquer les connexions entrantes non nécessaires

### 4.2 Mises à jour automatiques

Activez Windows Update:
- Paramètres > Windows Update
- Activer les mises à jour automatiques

### 4.3 Monitoring

Configurez:
- **Uptime monitoring** - UptimeRobot ou similaire pour le frontend
- **Error tracking** - Sentry pour les erreurs applicatives
- **Log aggregation** - CloudWatch Logs ou similaire

## 🔄 Étape 5: Branching et Preview

### 5.1 Configurer Neon Branching

Neon supporte le branching pour les environnements de preview:

1. Dans Neon, créez une branche `preview`
2. Notez la connection string de la branche

### 5.2 Configurer Vercel Preview Deployments

Dans Vercel, activez les preview deployments:

1. Project Settings > Git
2. Activez "Preview Deployments"
3. Ajoutez les variables d'environnement spécifiques preview:
   - `DATABASE_URL` = connection string branche preview
   - `DATABASE_URL_DIRECT` = connection string branche preview
   - `APP_ENV` = `preview`

Chaque PR aura maintenant un environnement de preview automatique.

## 📊 Étape 6: Monitoring et alertes

### 6.1 Health checks

Le frontend expose un endpoint health:
```
GET /api/v1/health
```

Configurez un monitoring pour vérifier toutes les minutes.

### 6.2 Logs

Vercel fournit les logs via:
- Dashboard > Logs
- CLI: `vercel logs`

Pour le moteur, configurez:
- Rotation des logs (max 100MB)
- Logs envoyés vers un service centralisé

### 6.3 Alertes

Configurez des alertes pour:
- Frontend down (uptime monitoring)
- Erreurs 5xx (Sentry)
- Moteur sans heartbeat (monitoring custom)
- DB connection errors (Neon monitoring)

## 🔄 Étape 7: Mises à jour

### 7.1 Frontend

Les mises à jour sont automatiques via Vercel:
- Push vers `main` → déploiement automatique
- Preview deployments pour les PRs

### 7.2 Migrations DB

```bash
# Localement
npm run db:generate

# En production (via Vercel CLI ou SSH sur un worker)
vercel env pull .env.production
npm run db:migrate
```

### 7.3 Moteur

```powershell
# Sur le VPS
cd C:\mt5-engine\engine
git pull
.venv\Scripts\activate
pip install -r requirements.txt
sc stop MT5Engine
sc start MT5Engine
```

## 🚨 Étape 8: Backup et récupération

### 8.1 Backups automatiques

Neon fournit des backups automatiques:
- Point-in-time recovery (jusqu'à 7 jours)
- Copies de snapshot manuelles

### 8.2 Export des données

Script pour exporter les données importantes:

```bash
# Via pg_dump
pg_dump $DATABASE_URL > backup.sql
```

### 8.3 Récupération

Si nécessaire:
1. Restaurer depuis un snapshot Neon
2. Ou appliquer le fichier `backup.sql`

## ✅ Checklist de déploiement

- [ ] Base de données Neon créée et configurée
- [ ] Migrations appliquées
- [ ] Base de données seedée (admin créé)
- [ ] Frontend déployé sur Vercel
- [ ] Variables d'environnement configurées
- [ ] Domaine configuré (optionnel)
- [ ] SSL/HTTPS validé
- [ ] VPS Contabo provisionné
- [ ] MT5 installé sur le VPS
- [ ] Moteur Python installé
- [ ] Windows Agent configuré
- [ ] Service Windows créé
- [ ] Moteur connecté au backend (heartbeat OK)
- [ ] Firewall configuré
- [ ] Monitoring activé
- [ ] Alertes configurées
- [ ] Documentation mise à jour

## 🆘 Dépannage

### Frontend ne démarre pas

Vérifiez:
- Variables d'environnement dans Vercel
- Logs Vercel
- Connection à la base de données

### Moteur ne se connecte pas

Vérifiez:
- Service Windows tourne (`sc query MT5Engine`)
- Logs du moteur
- `ENGINE_AUTH_SECRET` identique au backend
- Firewall autorise les connexions sortantes
- URL backend correcte

### MT5 ne répond pas

Vérifiez:
- MT5 installé dans le bon chemin
- Windows Agent tourne
- MT5 peut se connecter au broker
- Logs MT5

### Erreurs de DB

Vérifiez:
- Connection string correcte
- SSL activé (`sslmode=require`)
- IP allowlist Neon si configurée
- Pool Neon activé

## 📞 Support

Pour les problèmes de déploiement:
- Consultez les logs Vercel
- Consultez les logs Neon
- Consultez les logs du moteur
- Contactez l'équipe technique
