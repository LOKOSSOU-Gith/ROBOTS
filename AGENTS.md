# Conventions du projet MT5 SaaS Platform

Ce document définit les conventions et patterns suivis par le projet pour assurer la cohérence et la qualité du code.

## 🎯 Principes directeurs

1. **Sécurité avant tout**: Aucun compromis sur la sécurité
2. **Exactitude financière**: Utilisation d'arithmétique décimale exacte
3. **Validation serveur**: Jamais de confiance envers le client
4. **Tests obligatoires**: TDD pour la logique métier
5. **Documentation minimale**: Code auto-documenté

## 📐 Architecture

### Séparation des couches

```
┌─────────────────────────────────────────┐
│          Frontend (Next.js)            │
│  - Composants UI                       │
│  - Client API                          │
│  - Validation Zod (répétition)         │
└──────────────┬──────────────────────────┘
               │ HTTP (session auth)
┌──────────────▼──────────────────────────┐
│         Backend (Next.js API)           │
│  - Route Handlers                      │
│  - Services métier                     │
│  - Domain logic (pure)                 │
│  - DB access (Drizzle)                 │
└──────────────┬──────────────────────────┘
               │ HTTP (engine auth)
┌──────────────▼──────────────────────────┐
│         Moteur Python (Contabo)         │
│  - Stratégies de trading               │
│  - Gestion des risques                 │
│  - Communication MT5                   │
└─────────────────────────────────────────┘
```

### Domain-Driven Design

Le code métier pur vit dans `src/server/domain/`:

- **objectives.ts** - Calculs d'objectifs de gain/perte
- **parameters.ts** - Validation des paramètres de stratégie
- **robotSettings.ts** - Schémas de formulaires
- **states.ts** - Transitions d'état des instances
- **strategies.ts** - Catalogue de stratégies
- **volume.ts** - Arithmétique décimale exacte

**Règle**: La logique de domaine ne doit jamais dépendre de la DB, de l'HTTP ou du temps.

## 💰 Arithmétique financière

### Toujours utiliser des strings

Les montants financiers sont stockés et manipulés comme des strings, jamais comme des nombres flottants.

```typescript
// ✅ Bon
const total = sumNumeric(["10.50", "5.25"]); // "15.75"

// ❌ Mauvais
const total = 10.50 + 5.25; // 15.749999999999998
```

### Fonctions utilitaires

Dans `src/server/domain/volume.ts`:

- `toScaled(value: string): bigint` - Convertit en entier échelonné
- `fromScaled(scaled: bigint): string` - Convertit depuis l'entier
- `sumNumeric(values: string[]): string` - Additionne sans erreur
- `compareNumeric(a: string, b: string): number` - Compare sans erreur
- `resolveLot(volume: string, constraints): {...}` - Arrondit au pas du broker

### Exemple d'utilisation

```typescript
import { toScaled, sumNumeric, resolveLot } from "@/server/domain/volume";

// Calcul de P&L
const pnl = sumNumeric([realized, floating, commissions, swaps]);

// Résolution de lot avec contraintes broker
const lot = resolveLot("0.015", {
  minLot: "0.01",
  maxLot: "10.00",
  lotStep: "0.01",
});
// lot.volume = "0.01" (arrondi vers le bas)
```

## 🔐 Sécurité

### Chiffrement des secrets

Les secrets MT5 sont chiffrés immédiatement à la réception:

```typescript
import { SecretBox } from "@/server/security/secrets";

const box = SecretBox.fromEnvironment();
const encrypted = box.encrypt(password);
// Stocker encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion
```

### Comparaison constante

Toujours utiliser `constantTimeEqual` pour les tokens:

```typescript
import { constantTimeEqual } from "@/server/security/tokens";

if (constantTimeEqual(userToken, expectedToken)) {
  // Ok
}
```

### Masquage des logs

Les données sensibles sont masquées automatiquement:

```typescript
import { redact } from "@/server/security/redact";

console.log(redact({ password: "secret", ok: 1 }));
// { password: "[masqué]", ok: 1 }
```

### Validation serveur

Jamais de confiance envers les données du client:

```typescript
// ❌ Mauvais - confiance aveugle
const userId = req.body.userId;

// ✅ Bon - validation et autorisation
const userId = session.userId;
if (userId !== target.ownerUserId) {
  throw forbidden();
}
```

## 🧪 Tests

### TDD pour la logique métier

Écrire le test avant l'implémentation:

```typescript
// 1. Écrire le test
it("refuse lot négatif", () => {
  const result = resolveLot("-0.01", constraints);
  expect(result.rejectedReason).toBe("non_positive");
});

// 2. Implémenter (failing d'abord)
// 3. Corriger pour passer
// 4. Refactoriser
```

### Tests de sécurité

Les tests de sécurité couvrent:
- Chiffrement/déchiffrement
- Rotation des clés
- Comparaison constante
- Masquage des logs
- Politique de mot de passe

### Tests d'intégration

Pour les tests avec DB:
- Utiliser une base de test séparée
- Nettoyer après chaque test
- Utiliser des transactions

## 📝 Validation avec Zod

### Schémas réutilisables

Les schémas Zod sont partagés entre client et serveur:

```typescript
// src/server/domain/robotSettings.ts
export const robotSettingsSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]+$/),
  initialLot: z.string().regex(/^\d+(\.\d{1,8})?$/),
  // ...
});

// Client
import { robotSettingsSchema } from "@/server/domain/robotSettings";
const result = robotSettingsSchema.safeParse(formData);
```

### Messages d'erreur personnalisés

```typescript
export const accountSchema = z.object({
  login: z.string().regex(/^\d+$/, "Numéro de compte requis"),
  // ...
});
```

## 🔄 États et transitions

### Machine d'état des instances

Les transitions d'état sont contrôlées:

```typescript
// src/server/domain/states.ts
export function transitionAllowed(from: InstanceState, to: InstanceState): boolean {
  const allowed: Record<InstanceState, InstanceState[]> = {
    STOPPED: ["STARTING"],
    STARTING: ["RUNNING", "STOPPED", "ERROR"],
    RUNNING: ["STOPPING", "ERROR", "RISK_HALTED"],
    // ...
  };
  return allowed[from]?.includes(to) ?? false;
}
```

### État effectif vs rapporté

L'état affiché tient compte du heartbeat du moteur:

```typescript
export function effectiveState(
  reported: InstanceState,
  lastEngineSeenAt: Date | null,
  now: Date,
): InstanceState {
  if (reported === "RUNNING" && !lastEngineSeenAt) {
    return "DISCONNECTED";
  }
  if (reported === "RUNNING" && now.getTime() - lastEngineSeenAt.getTime() > 45_000) {
    return "DISCONNECTED";
  }
  return reported;
}
```

## 📡 Communication Backend ↔ Moteur

### Commandes idempotentes

Chaque commande a une clé d'idempotence:

```typescript
await enqueueCommand(userId, robotId, "start", {}, {
  idempotencyKey: crypto.randomUUID(),
});
```

### Accusés de réception

Le moteur envoie des accusés pour chaque transition:

- `received` - Commande lue
- `accepted` - Commande acceptée
- `started` - Exécution commencée
- `completed` - Exécution terminée
- `failed` - Échec
- `rejected` - Rejetée

### Heartbeat

Le moteur envoie un heartbeat toutes les 15s avec:
- État de chaque instance
- Snapshots des comptes
- Métriques système

## 🗄️ Base de données

### Migrations Drizzle

Les migrations sont générées automatiquement:

```bash
npm run db:generate  # Génère depuis le schéma
npm run db:migrate  # Applique les migrations
```

### Transactions

Toujours utiliser des transactions pour les opérations multi-tables:

```typescript
await db.transaction(async (tx) => {
  const secret = await tx.insert(secretRecords).values(...);
  const account = await tx.insert(tradingAccounts).values(...);
  // Tout ou rien
});
```

### Indexes

Les indexes sont définis dans le schéma:

```typescript
export const instances = pgTable("instances", {
  // ...
}, (t) => ({
  ownerIdx: index("instances_owner_idx").on(t.ownerUserId),
  stateIdx: index("instances_state_idx").on(t.state),
}));
```

## 🎨 Frontend

### Composants réutilisables

Les composants UI sont dans `src/components/`:

- `ui.tsx` - Composants shadcn/ui exportés
- `status-badge.tsx` - Badge d'état
- `robot-actions.tsx` - Actions sur un robot
- `auto-refresh.tsx` - Auto-refresh des données

### Client API

Le client API centralise les appels HTTP:

```typescript
// src/lib/client-api.ts
export async function startRobot(robotId: string): Promise<CommandResult> {
  return await apiRequest(`/api/v1/robots/${robotId}/start`, {
    method: "POST",
  });
}
```

### Forms

Les formulaires utilisent les schémas Zod du serveur:

```typescript
import { robotSettingsSchema } from "@/server/domain/robotSettings";

const form = useForm<z.infer<typeof robotSettingsSchema>>({
  resolver: zodResolver(robotSettingsSchema),
});
```

## 🚨 Interdictions

### Jamais

- ❌ Stocker un secret en clair
- ❌ Comparer des tokens sans `constantTimeEqual`
- ❌ Faire confiance aux données du client
- ❌ Utiliser des flottants pour l'argent
- ❌ Logger des mots de passe ou tokens
- ❌ Implémenter du Martingale
- ❌ Permettre le mode réel sans validation
- ❌ Modifier directement la DB en production

### Toujours

- ✅ Valider côté serveur
- ✅ Chiffrer les secrets immédiatement
- ✅ Utiliser des strings pour l'argent
- ✅ Écrire des tests pour la logique métier
- ✅ Masquer les données sensibles dans les logs
- ✅ Utiliser des transactions DB
- ✅ Documenter pourquoi (pas quoi)

## 📚 Ressources

- [Cahier des charges](./_extracted_cdc.txt) - Spécification complète
- [Drizzle ORM](https://orm.drizzle.team/) - Documentation ORM
- [Zod](https://zod.dev/) - Documentation validation
- [Next.js 15](https://nextjs.org/docs) - Documentation framework
