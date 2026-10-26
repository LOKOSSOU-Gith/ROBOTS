import { ShieldCheck } from "lucide-react";

import { AccountForm } from "./account-form";
import { ConnectionActions } from "./account-actions";
import { Badge, Card, CardBody, CardHeader, Notice } from "@/components/ui";
import { formatAgo, formatMoney } from "@/lib/format";
import { requirePageUser } from "@/server/auth/session";
import { listAccounts } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requirePageUser();
  const accounts = await listAccounts(user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Connexion MT5</h1>
        <p className="mt-0.5 text-xs text-muted">
          Un compte par serveur. Les robots sont créés automatiquement après enregistrement.
        </p>
      </div>

      <Notice tone="info" title="Le mot de passe ne transite jamais par le navigateur après saisie">
        Il est chiffré immédiatement côté serveur, stocké hors de PostgreSQL en clair et remis au
        moteur uniquement pour ouvrir une session. Il n&apos;est jamais journalisé ni renvoyé.
      </Notice>

      {accounts.map((account) => (
        <Card key={account.id}>
          <CardHeader
            title={`${account.broker} · ${account.server}`}
            subtitle={`Identifiant ${account.loginMasked} · ${account.robotCount} robot(s)`}
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={account.environment === "real" ? "danger" : "info"}>
                  {account.environment === "real" ? "Réel" : "Démo"}
                </Badge>
                <Badge
                  tone={
                    account.status === "connected"
                      ? "success"
                      : account.status === "error"
                        ? "danger"
                        : "warning"
                  }
                >
                  {account.status === "connected"
                    ? "Testé"
                    : account.status === "error"
                      ? "Erreur"
                      : "Non testé"}
                </Badge>
              </div>
            }
          />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted">Solde</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(account.balance, account.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted">Équité</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(account.equity, account.currency)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted">Marge</dt>
                <dd className="font-medium tabular-nums">{account.marginLevel ?? "—"} %</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted">Dernière donnée</dt>
                <dd className="font-medium">{formatAgo(account.lastSnapshotAt)}</dd>
              </div>
            </dl>

            <ConnectionActions
              accountId={account.id}
              environment={account.environment}
              realApproved={account.realApproved}
            />
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader
          title={accounts.length ? "Ajouter un autre compte" : "Enregistrer un compte MT5"}
          subtitle="Le mode démo est le mode par défaut. Le mot de passe de trading reste masqué."
        />
        <CardBody>
          <AccountForm disabled={accounts.length >= 5} />
          {accounts.length >= 5 ? (
            <p className="mt-3 text-xs text-warning">
              Limite de cinq comptes atteinte sur cette installation.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        La suppression d&apos;un compte est refusée tant que des robots sont actifs. Les secrets
        sont chiffrés avec une clé conservée dans l&apos;environnement serveur, séparée de la base
        de données.
      </p>
    </div>
  );
}
