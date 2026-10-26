# Guide de contribution

Merci de votre intérêt pour contribuer à la plateforme MT5 SaaS !

## 📋 Prérequis

- Node.js >= 18.18.0
- Python 3.10+ (si vous touchez au moteur)
- Docker (pour PostgreSQL local)
- Connaissance de TypeScript, React, Next.js
- Compréhension des concepts de sécurité (chiffrement, authentification)

## 🚀 Premiers pas

1. Fork le repository
2. Clonez votre fork:
```bash
git clone https://github.com/votre-username/mt5-saas-platform.git
cd mt5-saas-platform
```

3. Installez les dépendances:
```bash
npm install
```

4. Configurez l'environnement:
```bash
cp .env.example .env
# Éditez .env avec vos valeurs de développement
```

5. Lancez PostgreSQL:
```bash
docker-compose up -d
```

6. Lancez les migrations:
```bash
npm run db:migrate
npm run db:seed
```

7. Démarrez le serveur:
```bash
npm run dev
```

## 🧪 Tests

### Avant de committer

Assurez-vous que tous les tests passent:
```bash
npm run test
npm run typecheck
npm run lint
```

### Écrire des tests

Suivez l'approche TDD (Test-Driven Development):

1. Écrivez d'abord le test
2. Faites-le échouer
3. Implémentez le code minimum pour le faire passer
4. Refactorisez si nécessaire

#### Exemple de test unitaire

```typescript
// tests/domain.test.ts
import { describe, expect, it } from "vitest";
import { sumNumeric } from "@/server/domain/volume";

describe("arithmétique décimale exacte", () => {
  it("additionne sans erreur binaire", () => {
    expect(sumNumeric(["0.1", "0.2"])).toBe("0.3");
  });
});
```

### Tests d'intégration

Pour les tests qui nécessitent la base de données:
- Utilisez une base de données de test séparée
- Nettoyez les données après chaque test
- Utilisez des transactions pour isolation

## 📝 Conventions de code

### TypeScript

- Toujours utiliser des types explicites
- Éviter `any` sauf cas exceptionnel documenté
- Utiliser `readonly` pour les tableaux immuables
- Préférer les interfaces aux types pour les objets

```typescript
// ✅ Bon
interface User {
  id: string;
  email: string;
  readonly roles: string[];
}

// ❌ Éviter
const user: any = { id: 1, email: "test" };
```

### React/Next.js

- Utiliser les composants fonctionnels avec hooks
- Éviter les effets de bord dans le rendu
- Préférer `useCallback` et `useMemo` pour l'optimisation
- Utiliser le App Router de Next.js 15

```typescript
// ✅ Bon
export function RobotCard({ robot }: { robot: RobotView }) {
  const handleStart = useCallback(() => {
    // ...
  }, [robot.id]);

  return <button onClick={handleStart}>Démarrer</button>;
}
```

### Backend

- Valider toutes les entrées avec Zod
- Ne jamais faire confiance aux données du client
- Chiffrer immédiatement les secrets
- Utiliser des transactions pour les opérations multi-tables

```typescript
// ✅ Bon
const input = accountSchema.parse(raw);
const encrypted = SecretBox.fromEnvironment().encrypt(input.password);
await db.transaction(async (tx) => {
  // ...
});
```

### Nommage

- **Variables/Functions**: camelCase (`userName`, `getUser`)
- **Composants**: PascalCase (`RobotCard`, `LoginForm`)
- **Types/Interfaces**: PascalCase (`User`, `RobotView`)
- **Constantes**: UPPER_SNAKE_CASE (`MAX_LOT_SIZE`, `DATABASE_URL`)
- **Fichiers**: kebab-case (`robot-settings.tsx`, `api-routes.ts`)

### Commentaires

- Éviter les commentaires évidents
- Documenter le "pourquoi" pas le "quoi"
- Utiliser JSDoc pour les fonctions exportées

```typescript
// ❌ Éviter
// Récupère l'utilisateur
const user = await getUser(id);

// ✅ Bon
// Récupère l'utilisateur avec ses rôles actifs seulement (historique exclu)
const user = await getUser(id);
```

## 🔄 Workflow Git

### Branches

- `main` - Branchement de production
- `develop` - Branchement d'intégration
- `feature/*` - Nouvelles fonctionnalités
- `bugfix/*` - Corrections de bugs
- `hotfix/*` - Corrections urgentes en production

### Commits

Utilisez des messages de commit clairs et descriptifs:

```
type(scope): description

Exemples:
feat(auth): ajouter l'authentification 2FA
fix(trading): corriger le calcul du volume de risque
docs(readme): mettre à jour les instructions d'installation
refactor(db): optimiser les requêtes positions
test(security): ajouter tests pour le chiffrement
```

### Pull Requests

1. Faites rebase votre branche sur `develop` avant d'ouvrir
2. Remplissez le template de PR
3. Assurez-vous que tous les checks CI passent
4. Répondez aux reviews rapidement

## 🔒 Sécurité

### Règles absolues

- ❌ Jamais de secrets en clair dans le code
- ❌ Jamais de logs de mots de passe ou tokens
- ❌ Jamais de validation uniquement côté client
- ❌ Jamais de comparaison de strings non constante
- ❌ Jamais de `eval()` ou similaire

### Signalement de vulnérabilités

Si vous découvrez une vulnérabilité de sécurité:
1. Ne créez pas d'issue publique
2. Contactez l'équipe de sécurité directement
3. Attendez confirmation avant de divulguer

## 📦 Dépendances

### Ajouter une dépendance

Avant d'ajouter une nouvelle dépendance:
1. Vérifiez si elle est vraiment nécessaire
2. Préférez les bibliothèques maintenues et populaires
3. Vérifiez la taille du bundle
4. Lisez la documentation de sécurité

```bash
# Pour le runtime
npm add package-name

# Pour le développement
npm add -D package-name
```

### Mises à jour

- Mettez à jour régulièrement les dépendances
- Testez après chaque mise à jour majeure
- Consultez les changelog pour les breaking changes

## 🎯 Revue de code

### Quand demander une revue

- Avant de merger dans `develop`
- Pour les changements critiques (sécurité, paiement)
- Pour les refactorings importants

### Comment faire une revue

1. Vérifiez la logique métier
2. Vérifiez la sécurité
3. Vérifiez les tests
4. Vérifiez la documentation
5. Soyez constructif et respectueux

## 📚 Documentation

### À documenter

- Nouvelles fonctionnalités
- Changements cassants
- APIs publiques
- Schémas de base de données
- Scripts de déploiement

### Où documenter

- README.md - Vue d'ensemble et démarrage rapide
- DEPLOYMENT.md - Instructions de déploiement
- AGENTS.md - Conventions du projet
- Code comments - JSDoc pour les exports
- Inline comments - Pour la logique complexe

## 🐛 Signalement de bugs

### Avant de signaler

1. Vérifiez si le bug existe déjà
2. Reproduisez le bug de manière fiable
3. Testez sur la dernière version
4. Préparez un cas de reproductibilité minimal

### Template d'issue

```markdown
## Description
Brève description du bug

## Étapes pour reproduire
1. Aller à '...'
2. Cliquer sur '....'
3. Faire défiler jusqu'à '....'
4. Voir l'erreur

## Comportement attendu
Ce qui devrait se passer

## Comportement actuel
Ce qui se passe réellement

## Screenshots
Si applicable

## Environnement
- OS: [e.g. Windows 11]
- Navigateur: [e.g. Chrome 120]
- Version: [e.g. 1.0.0]

## Logs
Logs pertinents
```

## 💡 Suggestions de fonctionnalités

### Avant de proposer

1. Vérifiez si la fonctionnalité existe déjà
2. Vérifiez si elle est dans la roadmap
3. Expliquez le cas d'usage
4. Expliquez pourquoi c'est important

### Template

```markdown
## Description
Description de la fonctionnalité proposée

## Cas d'usage
Qui en aurait besoin et pourquoi

## Solution proposée
Comment vous voyez l'implémentation

## Alternatives
Autres approches envisagées
```

## 📞 Contact

Pour les questions:
- Issues GitHub pour les bugs et features
- Discussions GitHub pour les questions générales
- Email de l'équipe pour les questions urgentes

Merci de contribuer ! 🎉
