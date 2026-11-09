import { createHash, randomUUID } from "node:crypto";
import type { Store } from "./store";
import { groupKey, installBills, classificationDecisions } from "./bills";
import { transferCandidates, transferState } from "./transfers";
import { signature, description } from "./account-overlap";
type Kind = "bills" | "income_decisions" | "transfer_decisions";
const kinds: Kind[] = ["bills", "income_decisions", "transfer_decisions"];
const hash = (v: any) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fail = (message: string) => {
  throw Object.assign(Error(message), { code: "LINK_REVIEW_REQUIRED" });
};
export class AccountLinking {
  constructor(public store: Store) {
    installBills(store);
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS income_decisions(env TEXT,key TEXT,name TEXT,status TEXT,PRIMARY KEY(env,key)); CREATE TABLE IF NOT EXISTS transfer_decisions(env TEXT,key TEXT,status TEXT,PRIMARY KEY(env,key))",
    );
  }
  get db() {
    return this.store.db;
  }
  get env() {
    return this.store.env;
  }
  operations() {
    return (
      this.db
        .prepare(
          "SELECT * FROM account_links WHERE env=? ORDER BY created_at DESC",
        )
        .all(this.env) as any[]
    ).map((o) => ({
      ...o,
      snapshot: undefined,
      previous: JSON.parse(o.snapshot).accounts.map((a: any) => ({
        id: a.id,
        name: a.name,
        included: !!a.included,
      })),
      conflicts: o.status === "linked" ? this.unlinkReview(o.id).conflicts : [],
    }));
  }
  redirects() {
    return (
      this.db
        .prepare(
          "SELECT left_id,right_id FROM account_links WHERE env=? AND status='linked'",
        )
        .all(this.env) as any[]
    ).map((o) => ({ env: this.env, from: o.right_id, to: o.left_id }));
  }
  private operation(id: string) {
    const op = this.db
      .prepare("SELECT * FROM account_links WHERE env=? AND id=?")
      .get(this.env, id) as any;
    if (!op || op.status !== "linked")
      fail("Linked operation not found. Reload account matches.");
    return op;
  }
  private records(kind: Kind) {
    return this.db
      .prepare(`SELECT * FROM ${kind} WHERE env=? ORDER BY key`)
      .all(this.env) as any[];
  }
  private account(id: string) {
    return this.store.repository.listAccounts().find((a) => a.id === id);
  }
  private groups(leftId: string, rightId: string) {
    // Register only exact legacy transfer evidence before collecting choices.
    transferState(this.store);
    const raw = this.store.repository.rawHistory();
    const groups: any[] = [];
    for (const kind of ["bills", "income_decisions"] as Kind[]) {
      const map = new Map<string, Set<string>>();
      for (const t of raw.filter((t) =>
        [leftId, rightId].includes(t.canonicalAccountId),
      )) {
        const target = groupKey({ ...t, canonicalAccountId: leftId });
        const keys = map.get(target) ?? new Set<string>();
        keys.add(groupKey(t));
        keys.add(groupKey({ ...t, canonicalAccountId: undefined }));
        map.set(target, keys);
      }
      for (const [target, keys] of map) {
        const options = this.records(kind)
          .filter((d) => keys.has(d.key))
          .map((d) => ({ id: d.key, ...d }));
        if (options.length)
          groups.push({ id: `${kind}:${target}`, kind, target, options });
      }
    }
    const pairs = [
      ...transferCandidates(raw),
      ...transferCandidates(this.store.repository.history("all")),
    ];
    for (const d of this.records("transfer_decisions")) {
      const pair = pairs.find((p) => p.key === d.key);
      // Legacy aliases are evidence-backed and may already have been registered by readers.
      const alias = this.db
        .prepare(
          "SELECT canonical_key FROM decision_id_aliases WHERE env=? AND kind=? AND legacy_key=?",
        )
        .all(this.env, "transfer_decisions", d.key) as any[];
      const match =
        pair ?? pairs.find((p) => alias.some((a) => a.canonical_key === p.key));
      if (
        match &&
        [match.out, match.into].some((t) =>
          [leftId, rightId].includes(t.canonicalAccountId),
        )
      )
        groups.push({
          id: `transfer_decisions:${d.key}`,
          kind: "transfer_decisions",
          target: d.key,
          options: [{ id: d.key, ...d }],
          optionPairs: {
            [d.key]: {
              out: match.out.sourceTransactionId,
              into: match.into.sourceTransactionId,
              accountIds: [
                match.out.canonicalAccountId,
                match.into.canonicalAccountId,
              ],
            },
          },
          pair: {
            out: match.out.sourceTransactionId,
            into: match.into.sourceTransactionId,
          },
        });
    }
    const merged = new Map<string, any>();
    for (const g of groups) {
      if (g.kind !== "transfer_decisions") {
        merged.set(g.id, g);
        continue;
      }
      const pair = pairs.find(
        (p) =>
          p.out.sourceTransactionId === g.pair.out &&
          p.into.sourceTransactionId === g.pair.into,
      )!;
      const identity = (t: any) => [
        [leftId, rightId].includes(t.canonicalAccountId)
          ? leftId
          : t.canonicalAccountId,
        signature(t),
      ];
      const key = `transfer_decisions:${hash([identity(pair.out), identity(pair.into)])}`;
      const previous = merged.get(key);
      if (previous) {
        previous.options.push(...g.options);
        previous.optionPairs = { ...previous.optionPairs, ...g.optionPairs };
      } else merged.set(key, { ...g, id: key });
    }
    return [...merged.values()];
  }
  blockingOperationId(...accountIds: string[]): string | null {
    if (!accountIds.length) return null;
    const parameters = accountIds.map(() => "?").join(",");
    const active = this.db
      .prepare(
        `SELECT id FROM account_links WHERE env=? AND status='linked' AND (left_id IN (${parameters}) OR right_id IN (${parameters}))`,
      )
      .get(this.env, ...accountIds, ...accountIds) as
      { id: string } | undefined;
    return active?.id ?? null;
  }
  review(leftId: string, rightId: string) {
    const left = this.account(leftId),
      right = this.account(rightId);
    if (!left || !right || leftId === rightId)
      fail("Choose two different existing accounts.");
    const l = left!,
      r = right!;
    const institution = (id: string) =>
      this.db
        .prepare("SELECT * FROM app_institutions WHERE env=? AND id=?")
        .get(this.env, id) as any;
    const li = institution(l.institutionId),
      ri = institution(r.institutionId);
    const rows = this.store.repository.rawHistory();
    const posted = (id: string) =>
      rows.filter(
        (t) =>
          t.canonicalAccountId === id &&
          !t.pending &&
          description(t.name) &&
          t.currency &&
          Number.isFinite(Number(t.amount)) &&
          /^\d{4}-\d{2}-\d{2}$/.test(t.date),
      );
    const ls = new Set(posted(leftId).map(signature)),
      rs = new Set(posted(rightId).map(signature));
    const matches = [...ls].filter((s) => rs.has(s));
    const metadata = this.store.repository.accounts();
    const sources = (id: string) =>
      this.db
        .prepare(
          "SELECT d.id,d.label,d.status FROM source_accounts s JOIN data_sources d ON d.env=s.env AND d.id=s.source_id WHERE s.env=? AND s.account_id=?",
        )
        .all(this.env, id) as any[];
    const leftSources = sources(leftId),
      rightSources = sources(rightId);
    const reasons: string[] = [];
    const uncertain: string[] = [];
    if (
      l.institutionId !== r.institutionId &&
      li?.provisional === 0 &&
      ri?.provisional === 0
    )
      reasons.push("Verified institutions differ.");
    else if (
      l.institutionId !== r.institutionId ||
      li?.provisional ||
      ri?.provisional
    )
      uncertain.push(
        "Institution identity is provisional; labels do not establish a match.",
      );
    for (const field of ["type", "subtype"] as const) {
      if (l[field] && r[field] && l[field] !== r[field])
        reasons.push(`Account ${field} differs.`);
      else if (!l[field] || !r[field])
        uncertain.push(`Account ${field} is unknown.`);
    }
    if (leftSources.some((s) => rightSources.some((t) => s.id === t.id)))
      reasons.push("Accounts from the same source cannot be linked.");
    if (matches.length < 3)
      reasons.push(
        "At least three distinct matching posted transaction signatures are required.",
      );
    const blockingId = this.blockingOperationId(leftId, rightId);
    const active = blockingId ? { id: blockingId } : null;
    if (active)
      reasons.push(
        "These accounts already belong to a link operation. Review and unlink that operation first.",
      );
    const enrich = (a: any, inst: any, src: any[]) => ({
      ...a,
      institution: inst?.name ?? "Unknown institution",
      provisional: !!inst?.provisional,
      sources: src,
      masks: metadata
        .filter((m) => m.canonicalAccountId === a.id)
        .map((m) => m.mask)
        .filter(Boolean),
    });
    const decisions = this.groups(leftId, rightId).map((g) => ({
      ...g,
      details: g.options.map((o: any) => {
        const evidenceRows = rows.filter(
          (t) =>
            groupKey(t) === o.key ||
            groupKey({ ...t, canonicalAccountId: undefined }) === o.key,
        );
        const accountName =
          this.account(evidenceRows[0]?.canonicalAccountId)?.name ??
          "Transfer between accounts";
        const exclusions = (o.excluded ? JSON.parse(o.excluded) : []).map(
          (id: any) => {
            const t = evidenceRows.find(
              (t) => t.sourceTransactionId === id || t.id === id,
            );
            return t
              ? {
                  date: t.date,
                  name: t.name,
                  amount: t.amount,
                  currency: t.currency,
                }
              : { unresolved: true };
          },
        );
        return { id: o.id, accountName, exclusions };
      }),
    }));
    const evidence = {
      matchingSignatures: matches.length,
      samples: matches.slice(0, 5).map((s) => {
        const [date, currency, amount, description] = JSON.parse(s);
        return { date, currency, amount, description };
      }),
      sharedMask: metadata.some(
        (a) =>
          a.canonicalAccountId === leftId &&
          a.mask &&
          metadata.some(
            (b) => b.canonicalAccountId === rightId && b.mask === a.mask,
          ),
      ),
    };
    const result = {
      left: enrich(l, li, leftSources),
      right: enrich(r, ri, rightSources),
      linkable: reasons.length === 0,
      confidence: uncertain.length ? "review" : "strong",
      reasons,
      uncertainty: uncertain,
      evidence,
      decisions,
      blockingOperationId: active?.id ?? null,
    };
    return {
      ...result,
      token: hash({
        ...result,
        rows: rows.filter((t) =>
          [leftId, rightId].includes(t.canonicalAccountId),
        ),
      }),
    };
  }
  suggestions() {
    const accounts = this.store.repository.listAccounts();
    return accounts
      .flatMap((a, i) =>
        accounts.slice(i + 1).map((b) => this.review(a.id, b.id)),
      )
      .filter((r) => r.linkable);
  }
  private insert(kind: Kind, row: any) {
    if (kind === "bills")
      this.db
        .prepare("INSERT OR REPLACE INTO bills VALUES(?,?,?,?,?)")
        .run(this.env, row.key, row.name, row.status, row.excluded ?? "[]");
    else if (kind === "income_decisions")
      this.db
        .prepare("INSERT OR REPLACE INTO income_decisions VALUES(?,?,?,?)")
        .run(this.env, row.key, row.name, row.status);
    else
      this.db
        .prepare("INSERT OR REPLACE INTO transfer_decisions VALUES(?,?,?)")
        .run(this.env, row.key, row.status);
  }
  private archive(kind: Kind, row: any) {
    this.db
      .prepare(
        "INSERT INTO decision_history(env,kind,legacy_key,payload,archived_at) VALUES(?,?,?,?,?)",
      )
      .run(
        this.env,
        kind,
        row.key,
        JSON.stringify(row),
        new Date().toISOString(),
      );
    this.db
      .prepare(`DELETE FROM ${kind} WHERE env=? AND key=?`)
      .run(this.env, row.key);
  }
  private eventId(sourceId: string) {
    const t = this.store.repository
      .rawHistory()
      .find((t) => t.sourceTransactionId === sourceId);
    if (!t) return sourceId;
    return (
      (
        this.db
          .prepare(
            "SELECT event_id FROM transaction_event_aliases WHERE env=? AND source_id=? AND transaction_id=? AND signature=?",
          )
          .get(this.env, t.connection, t.id, signature(t)) as any
      )?.event_id ?? sourceId
    );
  }
  link(input: any) {
    return this.db.transaction(() => {
      const review = this.review(input.leftId, input.rightId);
      if (input.confirm !== true)
        fail("Confirm that these sources represent the same real account.");
      if (!review.linkable) fail(review.reasons.join(" "));
      if (input.reviewToken !== review.token)
        fail("Account evidence changed. Reload the review before confirming.");
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.trim().length > 120 ||
        typeof input.included !== "boolean"
      )
        fail("Choose an account name and budgeting inclusion explicitly.");
      const sources = [...review.left.sources, ...review.right.sources];
      if (
        sources.some((s) =>
          this.db
            .prepare(
              "SELECT 1 FROM source_replacements WHERE env=? AND state!='complete' AND (new_source_id=? OR (old_source_id=? AND state!='cancelled'))",
            )
            .get(this.env, s.id, s.id),
        )
      )
        fail(
          "This source has a pending replacement. Confirm account matches in Data access so replacement review and preferences remain coordinated.",
        );
      if (
        !sources.some(
          (s) =>
            s.id === input.preferredSourceId &&
            s.status !== "historical" &&
            s.status !== "revoke_required",
        )
      )
        fail(
          "Choose a preferred active source. Reconnect a source if all are disconnected.",
        );
      for (const g of review.decisions)
        if (
          !g.options.some((o: any) => o.id === input.decisions?.[g.id]) &&
          input.decisions?.[g.id] !== "review"
        )
          fail("Choose how to resolve each classification before linking.");
      const ids = [input.leftId, input.rightId];
      const decisionKeys = new Set(
        review.decisions.flatMap((g) => [
          g.target,
          ...g.options.map((o: any) => o.key),
        ]),
      );
      const decisionAliases = (
        this.db
          .prepare("SELECT * FROM decision_id_aliases WHERE env=?")
          .all(this.env) as any[]
      ).filter(
        (a) =>
          decisionKeys.has(a.canonical_key) || decisionKeys.has(a.legacy_key),
      );
      const snapshot: any = {
        decisionAliases,
        accounts: this.db
          .prepare("SELECT * FROM app_accounts WHERE env=? AND id IN (?,?)")
          .all(this.env, ...ids),
        mappings: this.db
          .prepare(
            "SELECT * FROM source_accounts WHERE env=? AND account_id IN (?,?)",
          )
          .all(this.env, ...ids),
        decisions: review.decisions,
        after: [],
        name: input.name.trim(),
        included: Number(input.included),
      };
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO account_links VALUES(?,?,?,?,?,?,?,?)")
        .run(
          this.env,
          id,
          ...ids,
          input.preferredSourceId,
          "linked",
          JSON.stringify(snapshot),
          new Date().toISOString(),
        );
      for (const table of ["source_accounts", "account_id_aliases"])
        this.db
          .prepare(
            `UPDATE ${table} SET account_id=? WHERE env=? AND account_id=?`,
          )
          .run(input.leftId, this.env, input.rightId);
      this.db
        .prepare(
          "UPDATE app_accounts SET name=?,included=? WHERE env=? AND id=?",
        )
        .run(snapshot.name, snapshot.included, this.env, input.leftId);
      const reconciled = this.store.repository.history("all"),
        pairs = transferCandidates(reconciled);
      for (const g of review.decisions) {
        for (const o of g.options) this.archive(g.kind, o);
        const choice = g.options.find(
          (o: any) => o.id === input.decisions[g.id],
        );
        if (!choice) continue;
        const row = { ...choice, key: g.target };
        delete row.id;
        if (g.kind === "transfer_decisions") {
          const p = pairs.find(
            (p) =>
              p.out.canonicalTransactionId === this.eventId(g.pair.out) &&
              p.into.canonicalTransactionId === this.eventId(g.pair.into),
          );
          if (!p)
            fail(
              "The selected transfer cannot be preserved because its reconciled pair is missing or ambiguous. Review the source history and retry import before confirming this match.",
            );
          row.key = p.key;
        }
        if (g.kind === "bills")
          row.excluded = JSON.stringify(
            JSON.parse(row.excluded).map((value: any) => {
              if (typeof value !== "string") return value;
              const raw = this.store.repository
                .rawHistory()
                .filter(
                  (t) =>
                    groupKey({ ...t, canonicalAccountId: input.leftId }) ===
                    g.target,
                );
              const t =
                raw.find((t) => t.sourceTransactionId === value) ??
                raw.find(
                  (t) =>
                    t.id === value &&
                    snapshot.mappings.some(
                      (m: any) =>
                        m.source_id === t.connection &&
                        (groupKey({
                          ...t,
                          canonicalAccountId: m.account_id,
                        }) === choice.key ||
                          groupKey({ ...t, canonicalAccountId: undefined }) ===
                            choice.key),
                    ),
                );
              return t
                ? this.eventId(t.sourceTransactionId)
                : { legacyId: value, legacyGroupKey: choice.key };
            }),
          );
        this.insert(g.kind, row);
        snapshot.after.push({ kind: g.kind, row });
      }
      this.db
        .prepare("UPDATE account_links SET snapshot=? WHERE env=? AND id=?")
        .run(JSON.stringify(snapshot), this.env, id);
      return { id, accountId: input.leftId };
    })();
  }
  prefer(id: string, source: string) {
    const op = this.operation(id);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM source_replacements WHERE env=? AND new_source_id=? AND state!='complete'",
        )
        .get(this.env, source)
    )
      fail(
        "Complete replacement review in Data access before activating this source preference.",
      );
    const valid = this.db
      .prepare(
        "SELECT 1 FROM source_accounts s JOIN data_sources d ON d.env=s.env AND d.id=s.source_id WHERE s.env=? AND s.account_id=? AND s.source_id=? AND d.status NOT IN ('historical','revoke_required')",
      )
      .get(this.env, op.left_id, source);
    if (!valid) fail("Choose an active mapped source.");
    this.db
      .prepare(
        "UPDATE account_links SET preferred_source=? WHERE env=? AND id=?",
      )
      .run(source, this.env, id);
  }
  private affected(op: any) {
    const snap = JSON.parse(op.snapshot);
    const groups = this.groups(op.left_id, op.right_id);
    const keys = new Map<Kind, Set<string>>(
      kinds.map((k) => [k, new Set<string>()]),
    );
    for (const g of [...snap.decisions, ...groups]) {
      keys.get(g.kind as Kind)!.add(g.target);
      for (const o of g.options) keys.get(g.kind as Kind)!.add(o.key);
    }
    for (const a of snap.after) keys.get(a.kind as Kind)!.add(a.row.key);
    return kinds.flatMap((kind) =>
      this.records(kind)
        .filter((d) => keys.get(kind)!.has(d.key))
        .map((row) => ({ kind, row })),
    );
  }
  unlinkReview(id: string) {
    const op = this.operation(id),
      snap = JSON.parse(op.snapshot);
    const current = this.affected(op);
    const a = this.db
      .prepare("SELECT name,included FROM app_accounts WHERE env=? AND id=?")
      .get(this.env, op.left_id) as any;
    const conflicts: string[] = [];
    if (a?.name !== snap.name || a?.included !== snap.included)
      conflicts.push("The linked account name or budgeting inclusion changed.");
    if (
      hash(
        [...current].sort((a, b) =>
          (a.kind + a.row.key).localeCompare(b.kind + b.row.key),
        ),
      ) !==
      hash(
        [...snap.after].sort((a, b) =>
          (a.kind + a.row.key).localeCompare(b.kind + b.row.key),
        ),
      )
    )
      conflicts.push("Classifications changed after linking.");
    return {
      id,
      conflicts,
      current,
      preferences: a,
      previousPreferences: snap.accounts.map((a: any) => ({
        name: a.name,
        included: !!a.included,
      })),
      choices: ["restore_previous", "keep_survivor"],
    };
  }
  unlink(id: string, input: any) {
    return this.db.transaction(() => {
      const op = this.operation(id),
        snap = JSON.parse(op.snapshot),
        review = this.unlinkReview(id);
      if (input.confirm !== true)
        fail("Confirm unlinking and restoring separate accounts.");
      if (
        review.conflicts.length &&
        !["restore_previous", "keep_survivor"].includes(input.resolution)
      )
        fail(
          "Choose an explicit unlink resolution for later preferences and classifications.",
        );
      const keep = input.resolution === "keep_survivor";
      const current = this.affected(op);
      const beforePairs = transferCandidates(
        this.store.repository.history("all"),
      );
      for (const { kind, row } of current) this.archive(kind, row);
      const aliasKeys = new Set([
        ...current.map((c) => c.row.key),
        ...snap.decisions.flatMap((g: any) => [
          g.target,
          ...g.options.map((o: any) => o.key),
        ]),
      ]);
      for (const key of aliasKeys)
        this.db
          .prepare(
            "DELETE FROM decision_id_aliases WHERE env=? AND (canonical_key=? OR legacy_key=?)",
          )
          .run(this.env, key, key);
      for (const alias of snap.decisionAliases ?? [])
        this.db
          .prepare("INSERT OR IGNORE INTO decision_id_aliases VALUES(?,?,?,?)")
          .run(this.env, alias.kind, alias.legacy_key, alias.canonical_key);
      for (const m of snap.mappings)
        for (const table of ["source_accounts", "account_id_aliases"])
          this.db
            .prepare(
              `UPDATE ${table} SET account_id=? WHERE env=? AND source_id=? AND provider_account_id=?`,
            )
            .run(m.account_id, this.env, m.source_id, m.provider_account_id);
      for (const a of snap.accounts)
        if (!keep || a.id !== op.left_id)
          this.db
            .prepare(
              "UPDATE app_accounts SET name=?,included=? WHERE env=? AND id=?",
            )
            .run(a.name, a.included, this.env, a.id);
      // Keep-survivor excludes no ambiguous guessed transaction: retain exact event references as unresolved when the survivor lacks evidence.
      const translate = (row: any) => {
        if (!row.excluded) return row;
        return {
          ...row,
          excluded: JSON.stringify(
            JSON.parse(row.excluded).map((value: any) => {
              if (typeof value !== "string" || !value.startsWith("event:"))
                return value;
              const aliases = this.db
                .prepare(
                  "SELECT a.source_id,a.transaction_id FROM transaction_event_aliases a JOIN transactions t ON t.env=a.env AND t.connection=a.source_id AND t.id=a.transaction_id JOIN source_accounts s ON s.env=t.env AND s.source_id=t.connection AND s.provider_account_id=t.account WHERE a.env=? AND a.event_id=? AND s.account_id=?",
                )
                .all(this.env, value, op.left_id) as any[];
              return aliases.length === 1
                ? JSON.stringify([
                    this.env,
                    aliases[0].source_id,
                    aliases[0].transaction_id,
                  ])
                : { legacyId: value, legacyGroupKey: row.key };
            }),
          ),
        };
      };
      for (const g of snap.decisions)
        for (const o of g.options) {
          // Transfer keys fingerprint a pair, never a payee group. Each original
          // option retains its own source/account evidence even when choices coalesce.
          if (g.kind === "transfer_decisions") {
            const recorded = g.optionPairs?.[o.key];
            const oldAliasKeys = (snap.decisionAliases ?? [])
              .filter(
                (a: any) =>
                  a.kind === "transfer_decisions" && a.legacy_key === o.key,
              )
              .map((a: any) => a.canonical_key);
            const oldPair = recorded
              ? undefined
              : transferCandidates(this.store.repository.rawHistory()).find(
                  (p) => p.key === o.key || oldAliasKeys.includes(p.key),
                );
            const owners =
              recorded?.accountIds ??
              (oldPair
                ? [
                    oldPair.out.canonicalAccountId,
                    oldPair.into.canonicalAccountId,
                  ]
                : undefined);
            // Older snapshots without surviving ownership evidence retain the original
            // decision for unresolved review rather than silently discarding it.
            if (!keep || !owners || owners.includes(op.right_id))
              this.insert(g.kind, o);
            continue;
          }
          // Restoring the other account's original classifications is independent of keeping later survivor decisions.
          const owner = snap.mappings.find((m: any) =>
            this.store.repository
              .rawHistory()
              .some(
                (t) =>
                  t.connection === m.source_id &&
                  t.account === m.provider_account_id &&
                  (groupKey(t) === o.key ||
                    groupKey({ ...t, canonicalAccountId: undefined }) ===
                      o.key),
              ),
          )?.account_id;
          if (!keep || owner === op.right_id) this.insert(g.kind, o);
        }
      if (keep)
        for (const { kind, row } of current) {
          if (kind === "transfer_decisions") {
            const old = beforePairs.find((p) => p.key === row.key);
            const belongs = (candidate: any, original: any) =>
              candidate.sourceTransactionId === original.sourceTransactionId ||
              this.eventId(candidate.sourceTransactionId) ===
                original.canonicalTransactionId;
            const pair =
              old &&
              transferCandidates(this.store.repository.rawHistory()).find(
                (p) =>
                  belongs(p.out, old.out) &&
                  belongs(p.into, old.into) &&
                  [p.out, p.into].some(
                    (t) => t.canonicalAccountId === op.left_id,
                  ),
              );
            this.insert(kind, pair ? { ...row, key: pair.key } : row);
          } else this.insert(kind, translate(row));
        }
      this.db
        .prepare(
          "UPDATE account_links SET status='unlinked' WHERE env=? AND id=?",
        )
        .run(this.env, id);
      classificationDecisions(
        this.store,
        "bills",
        this.store.repository.rawHistory(),
      );
      classificationDecisions(
        this.store,
        "income_decisions",
        this.store.repository.rawHistory(),
      );
      transferState(this.store);
      this.db
        .prepare(
          "INSERT INTO decision_history(env,kind,legacy_key,payload,archived_at) VALUES(?,?,?,?,?)",
        )
        .run(
          this.env,
          "account_unlink",
          id,
          JSON.stringify({
            resolution: input.resolution ?? "restore_previous",
            current,
          }),
          new Date().toISOString(),
        );
      return { ok: true };
    })();
  }
}
