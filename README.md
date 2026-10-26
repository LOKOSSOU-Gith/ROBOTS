# MT5 SaaS Platform

Plateforme SaaS multi-clients de robots de trading MetaTrader 5 - Version 1.0

## 📋 Vue d'ensemble

Cette plateforme permet aux utilisateurs de connecter leurs comptes MT5, de choisir des stratégies de trading autorisées, de configurer des paramètres et de piloter l'exécution depuis une interface web. Les ordres sont exécutés par un moteur Python indépendant qui communique avec le terminal MT5.

### Architecture

- **Frontend**: Next.js 15 + TypeScript + Tailwind CSS (hébergé sur Vercel)
- **Backend**: Next.js API Routes + authentification par session
- **Base de données**: PostgreSQL (managé via Neon en production, Docker en dev)
- **Moteur d'exécution**: Python (déployé sur Contabo VPS)
- **Terminal MT5**: Windows Agent pour la communication avec MetaTrader 5

### Caractéristiques principales

- ✅ Multi-comptes MT5 (demo et réel)
- ✅ Multi-stratégies avec catalogue versionné
- ✅ Gestion des risques avec profils configurables
- ✅ Contrôles anti-Martingale stricts
- ✅ Mode réel uniquement après validation explicite
- ✅ Arrêt d'urgence global
- ✅ Historique complet des événements et positions
- ✅ Chiffrement AES-256-GCM des secrets MT5
- ✅ Audit trail complet

## 🚀 Démarrage rapide

### Prérequis

- Node.js >= 18.18.0
- Python 3.10+ (pour le moteur)
- Docker (pour PostgreSQL local)
- pnpm ou npm

### Installation

1. **Cloner le repository**
```bash
git clone <repository-url>
cd 1b48ce10
```

2. **Installer les dépendances**
```bash
npm install
```

3. **Démarrer PostgreSQL**
```bash
docker-compose up -d
```

4. **Configurer les variables d'environnement**
```bash
cp .env.example .env
# Éditer .env avec vos valeurs (voir section Configuration)
```

5. **Générer les clés de chiffrement**
```bash
node -e "console.log(JSON.stringify({'1':require('crypto').randomBytes(32).toString('base64')}))"
# Copier le résultat dans ENCRYPTION_KEY_RING
```

6. **Générer le secret d'authentification**
```bash
openssl rand -base64 48
# Copier le résultat dans AUTH_SECRET
```

7. **Lancer les migrations**
```bash
npm run db:migrate
```

8. **Seeder la base de données (crée l'admin)**
```bash
npm run db:seed
```

9. **Démarrer le serveur de développement**
```bash
npm run dev
```

L'application sera disponible sur http://localhost:3000

## ⚙️ Configuration

### Variables d'environnement essentielles

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Connexion PostgreSQL poolée | `postgres://app:pwd@localhost:5432/mt5_platform` |
| `AUTH_SECRET` | Clé secrète pour les sessions (32+ octets) | `base64 random 48 bytes` |
| `ENCRYPTION_KEY_RING` | Anneau de clés AES-256-GCM | `{"1":"<base64 32 bytes>"}` |
| `ENGINE_AUTH_SECRET` | Secret partagé avec le moteur | `32+ caractères aléatoires` |
| `ALLOW_REAL_ACCOUNTS` | Autoriser les comptes réels | `false` (défaut) |

Voir `.env.example` pour la liste complète.

## 🧪 Tests

### Tests unitaires
```bash
npm run test
```

### Tests en mode watch
```bash
npm run test:watch
```

### Type checking
```bash
npm run typecheck
```

### Linting
```bash
npm run lint
```

## 📦 Scripts disponibles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Serveur de développement Next.js |
| `npm run build` | Build pour production |
| `npm run start` | Démarrer en mode production |
| `npm run lint` | Linter ESLint |
| `npm run typecheck` | Vérification TypeScript |
| `npm run test` | Exécuter les tests Vitest |
| `npm run db:generate` | Générer les migrations Drizzle |
| `npm run db:migrate` | Appliquer les migrations |
| `npm run db:seed` | Seeder la base de données |
| `npm run db:studio` | Ouvrir Drizzle Studio |

## 🏗️ Structure du projet

```
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── (app)/          # Pages authentifiées
│   │   ├── api/            # API Routes
│   │   └── login/          # Page de connexion
│   ├── components/         # Composants React réutilisables
│   ├── lib/               # Utilitaires client
│   ├── server/            # Code serveur
│   │   ├── auth/          # Authentification et sessions
│   │   ├── db/            # Schéma et client PostgreSQL
│   │   ├── domain/        # Logique métier pure
│   │   ├── http/          # Utilitaires HTTP
│   │   ├── security/      # Sécurité (chiffrement, tokens)
│   │   └── services/      # Services métier
│   └── middleware.ts      # Middleware Next.js
├── engine/                # Moteur Python MT5
│   ├── src/mt5_engine/   # Code du moteur
│   ├── windows_agent/    # Agent Windows MT5
│   └── tests/            # Tests Python
├── drizzle/              # Migrations Drizzle
├── tests/                # Tests TypeScript
├── docker-compose.yml    # PostgreSQL local
└── .env.example          # Variables d'environnement template
```

## 🔒 Sécurité

### Principes de sécurité

- **Aucun secret en clair**: Les mots de passe MT5 sont chiffrés avec AES-256-GCM
- **Rotation des clés**: Support de l'anneau de clés pour rotation sans interruption
- **Comparaison constante**: Les tokens sont comparés en temps constant
- **Masquage des logs**: Toutes les données sensibles sont masquées automatiquement
- **Validation serveur**: Toutes les validations sont faites côté serveur
- **Authentification multi-niveaux**: Sessions sécurisées avec fingerprinting

### Interdictions

- ❌ Martingale et grilles de récupération
- ❌ Augmentation automatique des lots après perte
- ❌ Mode réel sans validation explicite
- ❌ Modification directe de la base de données

## 📊 Architecture du moteur

Le moteur Python communique avec le backend via HTTPS:

1. **Heartbeat**: Le moteur envoie un heartbeat toutes les 15s
2. **Commandes**: Le backend persiste les commandes avec idempotence
3. **Accusés**: Le moteur acquitte chaque transition (received → accepted → started → completed)
4. **Événements**: Le moteur envoie les événements de trading en temps réel
5. **Positions**: Snapshots réguliers des positions ouvertes

## 🚢 Déploiement

### Frontend (Vercel)

1. Connecter le repository à Vercel
2. Configurer les variables d'environnement
3. Déployer automatiquement sur push vers main

### Base de données (Neon)

1. Créer un projet Neon
2. Configurer `DATABASE_URL` et `DATABASE_URL_DIRECT`
3. Lancer les migrations: `npm run db:migrate`

### Moteur (Contabo)

1. Déployer sur un VPS Windows (nécessaire pour MT5)
2. Configurer `ENGINE_AUTH_SECRET` identique au backend
3. Démarrer le service Windows Agent
4. Installer Python et les dépendances du moteur

## 📝 Conventions de code

- **TypeScript strict**: Toujours utiliser des types explicites
- **Zod pour la validation**: Schémas de validation côté serveur et client
- **Arithmétique décimale exacte**: Utiliser des strings pour les montants financiers
- **Pas de commentaires inutiles**: Le code doit être auto-documenté
- **Tests TDD**: Écrire les tests avant d'implémenter

## 🤝 Contribution

1. Fork le repository
2. Créer une branche feature (`git checkout -b feature/ma-fonction`)
3. Commit avec des messages clairs
4. Push vers la branche (`git push origin feature/ma-fonction`)
5. Ouvrir une Pull Request

## 📄 Licence

Propriétaire - Tous droits réservés

## 🆘 Support

Pour les questions techniques ou incidents, contacter l'équipe de support.
