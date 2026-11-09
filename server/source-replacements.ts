import { randomUUID } from "node:crypto";
import type express from "express";
import type { Store } from "./store";
import type { Provider } from "./plaid";
import { replacementSourceIdentities } from "./source-identity";
import { AccountLinking } from "./account-linking";
export type ReplacementState =
  | "prepared"
  | "old_access_revoked"
  | "awaiting_link"
  | "importing"
  | "awaiting_account_review"
  | "reconciling"
  | "complete"
  | "cancelled"
  | "failed";
interface Replacement {
  env: string;
  id: string;
  old_source_id: string;
  new_source_id: string | null;
  state: ReplacementState;
  requested_days: number;
  last_error: string | null;
}
interface SourceAccount {
  provider_account_id: string;
  account_id: string;
  name: string;
  included: number;
}
interface SavedReview {
  provider_account_id: string;
  account_id: string;
  outcome: "match" | "distinct";
  payload: string;
}
type Exclusive = (id: string, fn: () => Promise<void>) => Promise<void>;
const reject = (message: string): never => {
  throw Object.assign(Error(message), { code: "REPLACEMENT_REVIEW_REQUIRED" });
};
/** Durable stages contain no provider tokens. Cancel/failure never lifts analytical quarantine. */
export class SourceReplacements {
  readonly linking: AccountLinking;
  constructor(
    readonly store: Store,
    readonly provider: Provider,
    readonly exclusive: Exclusive,
    readonly sync: (id: string) => Promise<void>,
    readonly redirectUri?: string,
    readonly recovery = new Map<string, string>(),
  ) {
    this.linking = new AccountLinking(store);
  }
  private get db() {
    return this.store.db;
  }
  get(id: string): Replacement {
    return (
      (this.db
        .prepare("SELECT * FROM source_replacements WHERE env=? AND id=?")
        .get(this.store.env, id) as Replacement) ||
      reject("Replacement not found. Reload Data access.")
    );
  }
  private set(
    id: string,
    state: ReplacementState,
    lastError: string | null = null,
  ) {
    this.db
      .prepare(
        "UPDATE source_replacements SET state=?,last_error=? WHERE env=? AND id=?",
      )
      .run(state, lastError, this.store.env, id);
  }
  private accounts(source: string | null): SourceAccount[] {
    return this.db
      .prepare(
        "SELECT s.provider_account_id,s.account_id,a.name,a.included FROM source_accounts s JOIN app_accounts a ON a.env=s.env AND a.id=s.account_id WHERE s.env=? AND s.source_id=?",
      )
      .all(this.store.env, source) as SourceAccount[];
  }
  private reviews(id: string): SavedReview[] {
    return this.db
      .prepare(
        "SELECT * FROM replacement_reviews WHERE env=? AND operation_id=?",
      )
      .all(this.store.env, id) as SavedReview[];
  }
  view(id: string) {
    const o = this.get(id),
      error = o.last_error ? JSON.parse(o.last_error) : null;
    return {
      ...o,
      last_error: error?.message ?? null,
      resumeState: error?.stage ?? o.state,
      oldStatus: this.store.connection(o.old_source_id).status,
      oldDescription:
        replacementSourceIdentities(this.store).find(
          (s) => s.id === o.old_source_id,
        )?.description ?? "Data source",
      newStatus: o.new_source_id
        ? this.store.connection(o.new_source_id).status
        : null,
      accounts: this.accounts(o.new_source_id).map((a) => ({
        ...a,
        review:
          this.reviews(id).find(
            (r) => r.provider_account_id === a.provider_account_id,
          )?.outcome ?? null,
      })),
      existingAccounts: this.accounts(o.old_source_id),
    };
  }
  list() {
    return (
      this.db
        .prepare("SELECT id FROM source_replacements WHERE env=?")
        .all(this.store.env) as { id: string }[]
    ).map((o) => this.view(o.id));
  }
  private preflight(source: string, operationId?: string) {
    const ownLinks = new Set(
      operationId
        ? this.reviews(operationId)
            .filter((r) => r.outcome === "match")
            .map((r) => JSON.parse(r.payload).linkId)
        : [],
    );
    for (const account of this.accounts(source)) {
      const blocker = this.linking.blockingOperationId(account.account_id);
      if (blocker && !ownLinks.has(blocker))
        reject(
          "Review and unlink the existing account link in Accounts before replacing this source.",
        );
    }
  }
  private requireDistinctIdentity(source: string) {
    if (
      replacementSourceIdentities(this.store).find((s) => s.id === source)
        ?.needsNickname
    )
      reject(
        "These data sources have identical names and account details. Save a distinct Source nickname in Data access before preparing or revoking replacement access.",
      );
  }
  async prepare(source: string, confirm: unknown) {
    let id = "";
    await this.exclusive(source, async () => {
      if (confirm !== true)
        reject("Confirm preparation for a longer-history replacement.");
      if (!this.store.list().some((s) => s.id === source))
        reject("Source not found.");
      const pending = this.list().find(
        (o) =>
          o.state !== "complete" &&
          (o.old_source_id === source || o.new_source_id === source),
      );
      if (pending) {
        id = pending.id;
        return;
      }
      this.preflight(source);
      this.requireDistinctIdentity(source);
      id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO source_replacements VALUES(?,?,?,NULL,'prepared',365,NULL)",
        )
        .run(this.store.env, id, source);
    });
    return this.view(id);
  }
  private async locked(id: string, fn: (o: Replacement) => Promise<void>) {
    const original = this.get(id);
    await this.exclusive(original.old_source_id, async () => {
      const run = async () => {
        const o = this.get(id);
        try {
          await fn(o);
        } catch (error: any) {
          if (
            ![
              "REPLACEMENT_REVIEW_REQUIRED",
              "LINK_REVIEW_REQUIRED",
              "BUSY",
            ].includes(error.code)
          ) {
            const stage = this.get(id).state;
            this.set(
              id,
              "failed",
              JSON.stringify({
                stage,
                message: this.recovery.size
                  ? "The new connection could not be saved or revoked. Keep the app running and use Disconnect on the access-revocation-required source. Revoke access through your institution or Plaid Portal before restarting if cleanup cannot finish."
                  : "This step could not finish. Resume and retry; saved history is retained.",
              }),
            );
          }
          throw error;
        }
      };
      if (original.new_source_id)
        await this.exclusive(original.new_source_id, run);
      else await run();
    });
    return this.view(id);
  }
  private stage(o: Replacement, states: ReplacementState[]) {
    if (!states.includes(o.state))
      reject(
        "This step is not available now. Resume the replacement or reload its status.",
      );
  }
  private exposed<T>(o: Replacement, fn: () => T): T {
    return this.db.transaction(() => {
      this.set(o.id, "complete");
      const result = fn();
      this.set(o.id, o.state, o.last_error);
      return result;
    })();
  }
  async act(id: string, action: string, body: any = {}) {
    let token: string | undefined;
    let comparison: unknown;
    const result = await this.locked(id, async (o) => {
      if (action === "cancel") {
        if (o.state === "complete")
          reject(
            "Completed replacement cannot be cancelled; review account links to unlink.",
          );
        if (o.state !== "cancelled")
          this.set(
            id,
            "cancelled",
            JSON.stringify({
              stage:
                o.state === "failed"
                  ? JSON.parse(o.last_error!).stage
                  : o.state,
              message:
                "Replacement paused. Provider access is not restored or revoked by cancellation. Confirmed account links and classification choices remain; use Accounts to review and unlink them. Imported replacement records remain excluded from estimates until review completes.",
            }),
          );
        return;
      }
      if (action === "resume") {
        this.stage(o, ["cancelled", "failed"]);
        this.preflight(o.old_source_id, o.id);
        this.set(id, JSON.parse(o.last_error!).stage);
        return;
      }
      if (action === "revoke") {
        if (body.confirm !== true)
          reject("Explicitly confirm revoking old access before continuing.");
        this.stage(o, ["prepared", "old_access_revoked"]);
        this.preflight(o.old_source_id, o.id);
        if (this.store.connection(o.old_source_id).status !== "historical") {
          this.requireDistinctIdentity(o.old_source_id);
          try {
            await this.provider.call("/item/remove", {
              access_token: this.store.token(o.old_source_id),
            });
          } catch (error: any) {
            if (error.code !== "ITEM_NOT_FOUND") {
              this.store.sourceStatus(o.old_source_id, "revoke_required");
              throw error;
            }
          }
        }
        this.db.transaction(() => {
          this.store.sourceStatus(o.old_source_id, "historical", true);
          this.set(id, "old_access_revoked");
        })();
        return;
      }
      if (action === "link-token") {
        if (this.recovery.size)
          reject(
            "Use Disconnect on the access-revocation-required source first. Keep the app running until revocation succeeds, or revoke access at your institution before restarting.",
          );
        this.stage(o, ["old_access_revoked", "awaiting_link"]);
        if (this.store.connection(o.old_source_id).status !== "historical")
          reject("Old access must be revoked first.");
        const response = await this.provider.call("/link/token/create", {
          user: { client_user_id: `family-budget-${this.store.env}` },
          client_name: "Family Budget",
          products: ["transactions"],
          additional_consented_products: ["liabilities"],
          country_codes: ["US"],
          language: "en",
          transactions: { days_requested: o.requested_days },
          ...(this.redirectUri ? { redirect_uri: this.redirectUri } : {}),
        });
        this.set(id, "awaiting_link");
        token = response.link_token;
        return;
      }
      if (action === "exchange") {
        this.stage(o, [
          "awaiting_link",
          "importing",
          "awaiting_account_review",
          "reconciling",
          "complete",
        ]);
        if (o.new_source_id) return;
        if (
          typeof body.public_token !== "string" ||
          !body.public_token ||
          body.public_token.length > 1000
        )
          reject("A fresh Link completion is required.");
        const r = await this.provider.call("/item/public_token/exchange", {
          public_token: body.public_token,
        });
        if (typeof r.item_id !== "string" || typeof r.access_token !== "string")
          throw Error("Invalid exchange response");
        // Exchange response is persisted with the operation before any import or response.
        // Existing Items must never be attached as replacement candidates.
        if (this.store.list().some((s) => s.id === r.item_id))
          reject(
            "This source already exists. Reload replacement status before opening Link again.",
          );
        try {
          this.db.transaction(() => {
            this.store.connect(r.item_id, r.access_token, [], o.requested_days);
            this.db
              .prepare(
                "UPDATE source_replacements SET new_source_id=?,state='importing',last_error=NULL WHERE env=? AND id=?",
              )
              .run(r.item_id, this.store.env, id);
          })();
        } catch (error) {
          try {
            await this.provider.call("/item/remove", {
              access_token: r.access_token,
            });
          } catch {
            this.recovery.set(r.item_id, r.access_token);
          }
          throw error;
        }
        return;
      }
      if (action === "sync") {
        this.stage(o, ["importing", "awaiting_account_review", "reconciling"]);
        if (!o.new_source_id) reject("Complete Link first.");
        await this.sync(o.new_source_id!);
        // Logged matches remain reviewable/reversible; distinct choices require renewed review after import.
        this.db
          .prepare(
            "DELETE FROM replacement_reviews WHERE env=? AND operation_id=? AND outcome='distinct'",
          )
          .run(this.store.env, id);
        for (const review of this.reviews(id)) {
          const link = this.linking
            .operations()
            .find(
              (l) =>
                l.id === JSON.parse(review.payload).linkId &&
                l.status === "linked",
            );
          const account = this.accounts(o.new_source_id).find(
            (a) => a.provider_account_id === review.provider_account_id,
          );
          if (!link || account?.account_id !== review.account_id)
            this.db
              .prepare(
                "DELETE FROM replacement_reviews WHERE env=? AND operation_id=? AND provider_account_id=?",
              )
              .run(this.store.env, id, review.provider_account_id);
        }
        this.set(
          id,
          this.store.connection(o.new_source_id!).status === "ready"
            ? "awaiting_account_review"
            : "importing",
        );
        return;
      }
      if (action === "match-review") {
        this.stage(o, ["awaiting_account_review", "reconciling"]);
        if (
          !this.accounts(o.old_source_id).some(
            (a) => a.account_id === body.leftId,
          ) ||
          !this.accounts(o.new_source_id).some(
            (a) => a.account_id === body.rightId,
          )
        )
          reject(
            "Compare an old account with an imported replacement account.",
          );
        comparison = this.exposed(o, () =>
          this.linking.review(body.leftId, body.rightId),
        );
        return;
      }
      if (action === "review") {
        this.stage(o, ["awaiting_account_review", "reconciling"]);
        const a =
          this.accounts(o.new_source_id).find(
            (a) => a.provider_account_id === body.providerAccountId,
          ) ??
          reject(
            "Imported account not found. Refresh import and review again.",
          );
        if (body.confirm !== true)
          reject("Explicitly review a currently imported account.");
        const prior = this.reviews(id).find(
          (r) => r.provider_account_id === body.providerAccountId,
        );
        if (prior?.outcome === "match")
          reject(
            "This match is already linked. Use Accounts to review and unlink it before changing the choice.",
          );
        this.db.transaction(() => {
          let accountId = a.account_id,
            payload = {};
          if (body.outcome === "match") {
            const old =
              this.accounts(o.old_source_id).find(
                (a) => a.account_id === body.match?.leftId,
              ) ??
              reject(
                "Existing account not found. Refresh import and review again.",
              );
            if (body.match?.rightId !== a.account_id)
              reject(
                "Keep an existing account identity and compare this imported account.",
              );
            this.exposed(o, () => {
              const review = this.linking.review(
                body.match.leftId,
                body.match.rightId,
              );
              if (!review.linkable || body.match.reviewToken !== review.token)
                reject(
                  review.reasons.join(" ") ||
                    "Evidence changed. Review this account again.",
                );
              if (
                body.match.confirm !== true ||
                body.match.preferredSourceId !== o.new_source_id
              )
                reject("Confirm the match and choose the replacement source.");
              if (
                body.match.name !== old.name ||
                body.match.included !== !!old.included
              )
                reject(
                  "Keep the existing account name and budgeting inclusion during replacement. Edit preferences on the account afterward.",
                );
              for (const g of review.decisions)
                if (
                  !g.options.some(
                    (v: any) => v.id === body.match.decisions?.[g.id],
                  )
                )
                  reject(
                    "Choose an existing classification for each decision before completing replacement. Resolve review decisions in Accounts first.",
                  );
              const linked = this.linking.link(body.match);
              // This intentional pending preference keeps the historical representative until final release.
              this.db
                .prepare(
                  "UPDATE account_links SET preferred_source=? WHERE env=? AND id=?",
                )
                .run(o.old_source_id, this.store.env, linked.id);
              accountId = linked.accountId;
              payload = {
                linkId: linked.id,
                preferredSourceId: o.new_source_id,
              };
            });
          } else if (body.outcome !== "distinct")
            reject(
              "Choose a confirmed match or keep this as a distinct account.",
            );
          this.db
            .prepare(
              "INSERT OR REPLACE INTO replacement_reviews VALUES(?,?,?,?,?,?)",
            )
            .run(
              this.store.env,
              id,
              a.provider_account_id,
              accountId,
              body.outcome,
              JSON.stringify(payload),
            );
          this.set(
            id,
            this.accounts(o.new_source_id).every((a) =>
              this.reviews(id).some(
                (r) => r.provider_account_id === a.provider_account_id,
              ),
            )
              ? "reconciling"
              : "awaiting_account_review",
          );
        })();
        return;
      }
      if (action === "complete") {
        if (o.state === "complete") return;
        this.stage(o, ["awaiting_account_review", "reconciling"]);
        const accounts = this.accounts(o.new_source_id),
          reviews = this.reviews(id);
        if (
          !accounts.length ||
          accounts.some(
            (a) =>
              !reviews.some(
                (r) =>
                  r.provider_account_id === a.provider_account_id &&
                  r.account_id === a.account_id,
              ),
          )
        )
          reject(
            "Review every imported account before completing replacement.",
          );
        if (this.store.connection(o.new_source_id!).status !== "ready")
          reject(
            "History is still importing or access is unavailable. Retry import first.",
          );
        this.preflight(o.old_source_id, o.id);
        this.db.transaction(() => {
          // Lift quarantine only inside this transaction, so linking sees both sources for event/classification resolution.
          this.set(id, "complete");
          for (const r of reviews)
            if (r.outcome === "match") {
              const payload = JSON.parse(r.payload),
                link = this.linking
                  .operations()
                  .find(
                    (l) =>
                      l.id === payload.linkId &&
                      l.status === "linked" &&
                      l.left_id === r.account_id,
                  );
              if (!link)
                reject(
                  "A confirmed account link changed. Review and unlink the affected operation, then refresh import and review again.",
                );
              this.linking.prefer(link.id, o.new_source_id!);
            }
          const affected = new Set(
            [...accounts, ...this.accounts(o.old_source_id)].map(
              (a) => a.account_id,
            ),
          );
          if (
            this.store.repository
              .dataIssues()
              .some((i) => affected.has(i.accountId))
          )
            reject(
              "Overlapping history is still ambiguous. Review account history, retry import, or revise the account choices before completing.",
            );
        })();
        return;
      }
      reject("Unknown replacement action.");
    });
    return comparison ?? (token ? { ...result, link_token: token } : result);
  }
}
export function installReplacementApi(
  app: express.Express,
  store: Store,
  provider: Provider,
  exclusive: Exclusive,
  sync: (id: string) => Promise<void>,
  redirectUri?: string,
  recovery?: Map<string, string>,
) {
  const service = new SourceReplacements(
    store,
    provider,
    exclusive,
    sync,
    redirectUri,
    recovery,
  );
  const handle =
    (fn: (req: express.Request) => unknown): express.RequestHandler =>
    async (req, res, next) => {
      try {
        res.json(await fn(req));
      } catch (e: any) {
        if (
          ["REPLACEMENT_REVIEW_REQUIRED", "LINK_REVIEW_REQUIRED"].includes(
            e.code,
          )
        )
          res.status(409).json({ error: e.message, code: e.code });
        else next(e);
      }
    };
  app.get(
    "/api/source-replacements",
    handle(() => ({ operations: service.list() })),
  );
  app.post(
    "/api/data-sources/:id/replacements",
    handle((req) => service.prepare(String(req.params.id), req.body?.confirm)),
  );
  app.post(
    "/api/source-replacements/:id/:action",
    handle((req) =>
      service.act(
        String(req.params.id),
        String(req.params.action),
        req.body ?? {},
      ),
    ),
  );
}
