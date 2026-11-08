import { it, expect } from "vitest";
import request from "supertest";
import { Store } from "../server/store";
import { AccountLinking } from "../server/account-linking";
import { groupKey } from "../server/bills";
import { loadHiddenAccounts } from "../web/accountPreferences";
import { createApp } from "../server/app";
const origin = "http://localhost:3000";
async function fixture() {
  const store = new Store(":memory:", Buffer.alloc(32), "sandbox");
  store.connect("old", "fixture-old", [
    {
      account_id: "a",
      name: "Owner checking",
      type: "depository",
      mask: "1234",
    },
  ]);
  const calls: string[] = [],
    bodies: any[] = [];
  let failure = "",
    readiness = "HISTORICAL_UPDATE_COMPLETE",
    added: any[] = [],
    available: any[] = [
      { account_id: "b", name: "Checking", type: "depository" },
    ],
    wait: (() => Promise<void>) | undefined;
  const provider = {
    configured: true,
    call: async (path: string, body: any) => {
      calls.push(path);
      bodies.push(body);
      if (wait && path === "/item/remove") await wait();
      if (failure) throw Object.assign(Error("fixture"), { code: failure });
      if (path === "/link/token/create") return { link_token: "fixture-link" };
      if (path === "/item/remove") return {};
      if (path === "/item/public_token/exchange")
        return { item_id: "new", access_token: "fixture-new" };
      if (path === "/accounts/get")
        return { item: { item_id: "new" }, accounts: available };
      if (path === "/transactions/sync")
        return {
          added,
          modified: [],
          removed: [],
          next_cursor: "done",
          has_more: false,
          transactions_update_status: readiness,
        };
      throw Error(path);
    },
  };
  let app = createApp(store, provider, origin);
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const post = (path: string, body: any = {}) =>
    request(app)
      .post("/api" + path)
      .set("Host", "localhost:3000")
      .set("Origin", origin)
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(body);
  const get = (path: string) =>
    request(app)
      .get("/api" + path)
      .set("Host", "localhost:3000");
  const prepare = async () => {
    const r = await post("/data-sources/old/replacements", { confirm: true });
    expect(r.status).toBe(200);
    return r.body.id as string;
  };
  const restartView = () =>
    request(
      createApp(
        new Store(store.db, Buffer.alloc(32), "sandbox"),
        provider,
        origin,
      ),
    )
      .get("/api/source-replacements")
      .set("Host", "localhost:3000");
  return {
    store,
    post,
    get,
    calls,
    bodies,
    prepare,
    restartView,
    fail: (s: string) => (failure = s),
    ready: (s: string) => (readiness = s),
    rows: (rows: any[]) => (added = rows),
    available: (rows: any[]) => (available = rows),
    pause: (fn: () => Promise<void>) => (wait = fn),
  };
}
it("requests 365 days for new Link and retains existing request metadata", async () => {
  const f = await fixture();
  expect((await f.post("/link-token")).status).toBe(200);
  expect(f.bodies.at(-1).transactions.days_requested).toBe(365);
  await f.post("/connect", { public_token: "fixture-public" });
  expect(
    f.store.db
      .prepare("SELECT requested_days FROM data_sources WHERE id='new'")
      .get(),
  ).toEqual({ requested_days: 365 });
  expect(
    f.store.db
      .prepare("SELECT requested_days FROM data_sources WHERE id='old'")
      .get(),
  ).toEqual({ requested_days: 90 });
  const n = f.calls.length;
  for (const months of [3, 6, 12]) await f.get(`/bills?months=${months}`);
  expect(f.calls.length).toBe(n);
  f.store.db.close();
});
it("persists prepare without provider effects and requires explicit revocation", async () => {
  const f = await fixture(),
    id = await f.prepare();
  expect(f.calls).toEqual([]);
  expect((await f.get("/source-replacements")).body.operations[0].state).toBe(
    "prepared",
  );
  expect((await f.post(`/source-replacements/${id}/revoke`)).status).toBe(409);
  expect((await f.post(`/source-replacements/${id}/link-token`)).status).toBe(
    409,
  );
  expect(
    (await f.post(`/source-replacements/${id}/revoke`, { confirm: true })).body
      .state,
  ).toBe("old_access_revoked");
  expect(f.store.connection("old").token).toBeNull();
  expect(f.store.repository.listAccounts()).toHaveLength(1);
  expect(
    (await f.post("/data-sources/old/authorization-complete")).status,
  ).toBe(409);
  f.store.db.close();
});
it("failed revocation retains encrypted access and resumable stage; cancel/resume tells truth", async () => {
  const f = await fixture(),
    id = await f.prepare();
  f.fail("INSTITUTION_DOWN");
  expect(
    (await f.post(`/source-replacements/${id}/revoke`, { confirm: true }))
      .status,
  ).toBe(502);
  let op = (await f.get("/source-replacements")).body.operations[0];
  expect(op.state).toBe("failed");
  expect(op.resumeState).toBe("prepared");
  expect(f.store.connection("old").token).not.toBeNull();
  f.fail("");
  await f.post(`/source-replacements/${id}/resume`);
  await f.post(`/source-replacements/${id}/revoke`, { confirm: true });
  await f.post(`/source-replacements/${id}/link-token`);
  expect((await f.post(`/source-replacements/${id}/cancel`)).body.state).toBe(
    "cancelled",
  );
  expect(f.store.connection("old").status).toBe("historical");
  expect((await f.post(`/source-replacements/${id}/resume`)).body.state).toBe(
    "awaiting_link",
  );
  f.store.db.close();
});
it("invalid exchange retries, saved exchange is idempotent, partial import cannot complete, unknown accounts need explicit review", async () => {
  const f = await fixture(),
    id = await f.prepare(),
    base = `/source-replacements/${id}`;
  await f.post(base + "/revoke", { confirm: true });
  await f.post(base + "/link-token");
  f.fail("INVALID_PUBLIC_TOKEN");
  expect(
    (await f.post(base + "/exchange", { public_token: "bad" })).status,
  ).toBe(502);
  f.fail("");
  await f.post(base + "/resume");
  expect(
    (await f.post(base + "/exchange", { public_token: "fixture-public" })).body
      .state,
  ).toBe("importing");
  const count = f.calls.length;
  await f.post(base + "/exchange", { public_token: "fixture-public" });
  expect(f.calls.length).toBe(count);
  f.ready("INITIAL_UPDATE_COMPLETE");
  expect((await f.post(base + "/sync")).body.state).toBe("importing");
  expect((await f.post(base + "/complete")).status).toBe(409);
  f.ready("HISTORICAL_UPDATE_COMPLETE");
  expect((await f.post(base + "/sync")).body.state).toBe(
    "awaiting_account_review",
  );
  expect((await f.post(base + "/complete")).status).toBe(409);
  expect(
    (
      await f.post(base + "/review", {
        providerAccountId: "b",
        outcome: "distinct",
        confirm: true,
      })
    ).body.state,
  ).toBe("reconciling");
  expect((await f.post(base + "/complete")).body.state).toBe("complete");
  expect(f.store.repository.listAccounts()).toHaveLength(2);
  f.store.db.close();
});

const rows = (account: string) =>
  ["2026-08-01", "2026-09-01", "2026-10-01"].map((date, i) => ({
    transaction_id: account + i,
    account_id: account,
    date,
    name: "Utility",
    amount: 10,
    iso_currency_code: "USD",
  }));
async function imported(f: Awaited<ReturnType<typeof fixture>>) {
  const id = await f.prepare(),
    base = `/source-replacements/${id}`;
  await f.post(base + "/revoke", { confirm: true });
  await f.post(base + "/link-token");
  await f.post(base + "/exchange", { public_token: "fixture" });
  await f.post(base + "/sync");
  return { id, base };
}
async function match(f: Awaited<ReturnType<typeof fixture>>, base: string) {
  const left = f.store.repository
      .accounts()
      .find((a) => a.connection === "old").canonicalAccountId,
    right = f.store.repository
      .accounts()
      .find((a) => a.connection === "new").canonicalAccountId;
  const review = (
    await f.post(base + "/match-review", { leftId: left, rightId: right })
  ).body;
  const payload = {
    leftId: left,
    rightId: right,
    reviewToken: review.token,
    confirm: true,
    name: review.left.name,
    included: review.left.included,
    preferredSourceId: "new",
    decisions: Object.fromEntries(
      review.decisions.map((g: any) => [g.id, g.options[0].id]),
    ),
  };
  const response = await f.post(base + "/review", {
    providerAccountId: "b",
    outcome: "match",
    confirm: true,
    match: payload,
  });
  return { left, right, review, payload, response };
}
it("quarantines duplicate imports through cancel and failure then completes with stable identity and preferences", async () => {
  const f = await fixture();
  f.store.commit(
    "old",
    [{ added: rows("a"), modified: [], removed: [] }],
    "oldcursor",
    [],
  );
  const left = f.store.repository.accounts()[0].canonicalAccountId;
  f.store.db
    .prepare("UPDATE app_accounts SET included=0,name='Household' WHERE id=?")
    .run(left);
  const key = groupKey(f.store.repository.rawHistory()[0]);
  f.store.repository.writeDecision("bills", {
    key,
    name: "My utility",
    status: "saved",
    excluded: [],
  });
  f.store.repository.writeDecision("income_decisions", {
    key,
    name: "Income preference",
    status: "dismissed",
  });
  f.store.repository.writeDecision("transfer_decisions", {
    key: "unrelated-pair",
    status: "rejected",
  });
  f.rows(rows("b"));
  const { base } = await imported(f);
  expect(f.store.repository.rawHistory()).toHaveLength(6);
  expect(f.store.repository.history("all")).toHaveLength(3);
  expect(
    f.store.repository
      .dataIssues()
      .some((i) => i.kind === "replacement_pending"),
  ).toBe(true);
  await f.post(base + "/cancel");
  expect(f.store.repository.history("all")).toHaveLength(3);
  await f.post(base + "/resume");
  const m = await match(f, base);
  expect(m.response.status).toBe(200);
  expect(f.store.repository.listAccounts()).toHaveLength(1);
  expect(
    f.store.db.prepare("SELECT preferred_source FROM account_links").all(),
  ).toEqual([{ preferred_source: "old" }]);
  const done = await f.post(base + "/complete");
  expect(done.status).toBe(200);
  expect(done.body.state).toBe("complete");
  expect(f.store.repository.listAccounts()).toEqual([
    expect.objectContaining({ id: left, name: "Household", included: false }),
  ]);
  expect(f.store.repository.history("all")).toHaveLength(3);
  expect(f.store.repository.rawHistory()).toHaveLength(6);
  expect(f.store.db.prepare("SELECT name FROM bills").all()).toEqual([
    { name: "My utility" },
  ]);
  expect(f.store.db.prepare("SELECT name FROM income_decisions").all()).toEqual(
    [{ name: "Income preference" }],
  );
  expect(
    f.store.db
      .prepare("SELECT status FROM transfer_decisions WHERE key=?")
      .get("unrelated-pair"),
  ).toEqual({ status: "rejected" });
  const values = new Map([
    ["flow-hidden-accounts:sandbox", JSON.stringify([`account:${left}`])],
    ["flow-hidden-accounts:sandbox:migrated", "1"],
  ]);
  expect(
    loadHiddenAccounts(
      {
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => {
          values.set(k, v);
        },
      },
      "sandbox",
      f.store.repository.aliases(),
      new AccountLinking(f.store).redirects(),
    ),
  ).toContain(`account:${left}`);
  expect((await f.post(base + "/complete")).body.state).toBe("complete");
  f.store.db.close();
});
it("blocks stacked account operations before revocation and keeps unresolved overlap staged", async () => {
  const f = await fixture();
  f.store.commit(
    "old",
    [{ added: rows("a"), modified: [], removed: [] }],
    "cursor",
    [],
  );
  f.rows([...rows("b"), { ...rows("b")[0], transaction_id: "duplicate" }]);
  const { base } = await imported(f);
  expect((await match(f, base)).response.status).toBe(200);
  expect((await f.post(base + "/complete")).status).toBe(409);
  expect(
    f.store.db.prepare("SELECT preferred_source FROM account_links").all(),
  ).toEqual([{ preferred_source: "old" }]);
  expect(f.store.repository.history("all")).toHaveLength(3);
  f.rows(rows("b"));
  f.store.db
    .prepare(
      "DELETE FROM transactions WHERE connection='new' AND id='duplicate'",
    )
    .run();
  await f.post(base + "/sync");
  expect((await f.post(base + "/complete")).status).toBe(200);
  const n = f.calls.length;
  const blocked = await f.post("/data-sources/new/replacements", {
    confirm: true,
  });
  expect(blocked.status).toBe(409);
  expect(blocked.body.error).toContain("unlink");
  expect(f.calls).toHaveLength(n);
  f.store.db.close();
});
it("late imported accounts require fresh review; cancelled and failed imports remain quarantined", async () => {
  const f = await fixture();
  f.rows(rows("b"));
  const { base } = await imported(f);
  await f.post(base + "/review", {
    providerAccountId: "b",
    outcome: "distinct",
    confirm: true,
  });
  f.available([
    { account_id: "b", name: "Checking" },
    { account_id: "late", name: "Late savings" },
  ]);
  await f.post("/data-sources/new/sync");
  expect((await f.post(base + "/complete")).status).toBe(409);
  f.fail("INSTITUTION_DOWN");
  expect((await f.post(base + "/sync")).status).toBe(502);
  expect(f.store.repository.history("all")).toHaveLength(0);
  f.fail("");
  await f.post(base + "/cancel");
  expect(f.store.repository.history("all")).toHaveLength(0);
  f.store.db.close();
});
it("uses the disconnect/repair operation lock while revocation is in flight", async () => {
  const f = await fixture(),
    id = await f.prepare();
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  f.pause(async () => {
    entered();
    await waiting;
  });
  const revoking = f
    .post(`/source-replacements/${id}/revoke`, { confirm: true })
    .then((r) => r);
  await started;
  expect(
    (await f.post("/data-sources/old/authorization-complete")).body.code,
  ).toBe("BUSY");
  expect((await f.post("/data-sources/old/disconnect")).body.code).toBe("BUSY");
  release();
  expect((await revoking).status).toBe(200);
  expect(
    (await f.post("/data-sources/old/authorization-complete")).status,
  ).toBe(409);
  f.store.db.close();
});
it("completes multiple matched accounts with an existing transfer decision between them", async () => {
  const f = await fixture();
  f.store.accounts("old", [
    { account_id: "s", name: "Savings", type: "depository" },
  ]);
  const outgoing = rows("a").map((t) => ({
      ...t,
      amount: 100,
      name: "Transfer",
    })),
    incoming = rows("s").map((t) => ({ ...t, amount: -100, name: "Transfer" }));
  f.store.commit(
    "old",
    [{ added: [...outgoing, ...incoming], modified: [], removed: [] }],
    "cursor",
    [],
  );
  const { transferState } = await import("../server/transfers");
  const transfer = transferState(f.store).confirmed[0];
  expect(transfer).toBeDefined();
  f.store.repository.writeDecision("transfer_decisions", {
    key: transfer.key,
    status: "confirmed",
  });
  f.available([
    { account_id: "b", name: "Checking", type: "depository" },
    { account_id: "t", name: "Savings", type: "depository" },
  ]);
  f.rows([
    ...outgoing.map((t) => ({
      ...t,
      account_id: "b",
      transaction_id: "new" + t.transaction_id,
    })),
    ...incoming.map((t) => ({
      ...t,
      account_id: "t",
      transaction_id: "new" + t.transaction_id,
    })),
  ]);
  const { base } = await imported(f);
  for (const [old, next] of [
    ["a", "b"],
    ["s", "t"],
  ]) {
    const all = f.store.repository.accounts(),
      left = all.find(
        (a) => a.connection === "old" && a.id === old,
      ).canonicalAccountId,
      right = all.find(
        (a) => a.connection === "new" && a.id === next,
      ).canonicalAccountId;
    const review = (
      await f.post(base + "/match-review", { leftId: left, rightId: right })
    ).body;
    const match = {
      leftId: left,
      rightId: right,
      reviewToken: review.token,
      confirm: true,
      name: review.left.name,
      included: review.left.included,
      preferredSourceId: "new",
      decisions: Object.fromEntries(
        review.decisions.map((g: any) => [g.id, g.options[0].id]),
      ),
    };
    expect(
      (
        await f.post(base + "/review", {
          providerAccountId: next,
          outcome: "match",
          confirm: true,
          match,
        })
      ).status,
    ).toBe(200);
  }
  const result = await f.post(base + "/complete");
  expect(result.body.error).toBeUndefined();
  expect(result.body.state).toBe("complete");
  expect(
    transferState(f.store).confirmed.filter((p) => !p.automatic),
  ).toHaveLength(1);
  f.store.db.close();
});
it("blocks generic linking and preference activation while replacement review is pending; unlink remains reversible", async () => {
  const f = await fixture();
  f.store.commit(
    "old",
    [{ added: rows("a"), modified: [], removed: [] }],
    "cursor",
    [],
  );
  f.rows(rows("b"));
  const { base } = await imported(f);
  const all = f.store.repository.accounts(),
    left = all.find((a) => a.connection === "old").canonicalAccountId,
    right = all.find((a) => a.connection === "new").canonicalAccountId;
  const review = new AccountLinking(f.store).review(left, right),
    payload = {
      leftId: left,
      rightId: right,
      reviewToken: review.token,
      confirm: true,
      name: review.left.name,
      included: review.left.included,
      preferredSourceId: "new",
      decisions: {},
    };
  expect((await f.post("/account-links", payload)).status).toBe(409);
  expect((await match(f, base)).response.status).toBe(200);
  const link = new AccountLinking(f.store).operations()[0];
  expect(
    (
      await f.post(`/account-links/${link.id}/preferred-source`, {
        sourceId: "new",
      })
    ).status,
  ).toBe(409);
  await f.post(base + "/cancel");
  const undo = await f.post(`/account-links/${link.id}/unlink`, {
    confirm: true,
  });
  expect(undo.status).toBe(200);
  expect(f.store.repository.listAccounts()).toHaveLength(2);
  expect(f.store.repository.history("all")).toHaveLength(3);
  await f.post(base + "/resume");
  await f.post(base + "/sync");
  expect((await match(f, base)).response.status).toBe(200);
  expect((await f.post(base + "/complete")).status).toBe(200);
  f.store.db.close();
});

it("resumes persisted operations after app recreation at every stage without replaying provider actions", async () => {
  const f = await fixture(),
    id = await f.prepare(),
    base = `/source-replacements/${id}`;
  const check = async (state: string) => {
    const n = f.calls.length;
    expect((await f.restartView()).body.operations[0].state).toBe(state);
    expect(f.calls).toHaveLength(n);
  };
  await check("prepared");
  await f.post(base + "/revoke", { confirm: true });
  await check("old_access_revoked");
  await f.post(base + "/link-token");
  await check("awaiting_link");
  await f.post(base + "/cancel");
  await check("cancelled");
  await f.post(base + "/resume");
  f.fail("INVALID_PUBLIC_TOKEN");
  await f.post(base + "/exchange", { public_token: "bad" });
  await check("failed");
  f.fail("");
  await f.post(base + "/resume");
  await f.post(base + "/exchange", { public_token: "fixture" });
  await check("importing");
  await f.post(base + "/sync");
  await check("awaiting_account_review");
  await f.post(base + "/review", {
    providerAccountId: "b",
    outcome: "distinct",
    confirm: true,
  });
  await check("reconciling");
  await f.post(base + "/complete");
  await check("complete");
  f.store.db.close();
});
it("retains emergency revocation recovery when exchange succeeds but local persistence and cleanup fail", async () => {
  const f = await fixture(),
    id = await f.prepare(),
    base = `/source-replacements/${id}`;
  await f.post(base + "/revoke", { confirm: true });
  await f.post(base + "/link-token");
  const connect = f.store.connect.bind(f.store);
  f.store.connect = () => {
    f.fail("INSTITUTION_DOWN");
    throw Error("fixture write failure");
  };
  expect(
    (await f.post(base + "/exchange", { public_token: "fixture" })).status,
  ).toBe(502);
  const state = (await f.get("/state")).body;
  expect(
    state.connections.some(
      (s: any) => s.id === "new" && s.status === "revoke_required",
    ),
  ).toBe(true);
  expect(JSON.stringify(state)).not.toContain("fixture-new");
  f.store.connect = connect;
  f.fail("");
  await f.post(base + "/resume");
  const blocked = await f.post(base + "/link-token");
  expect(blocked.status).toBe(409);
  expect(blocked.body.error).toContain("Disconnect");
  expect((await f.post("/data-sources/new/disconnect")).status).toBe(200);
  expect((await f.post(base + "/link-token")).status).toBe(200);
  f.store.db.close();
});
it.each(["confirmed", "rejected"])(
  "rolls back replacement match when ambiguous overlap would discard the chosen %s transfer",
  async (status) => {
    const f = await fixture();
    f.store.accounts("old", [
      { account_id: "s", name: "Savings", type: "depository" },
    ]);
    const out = {
      transaction_id: "out",
      account_id: "a",
      date: "2026-10-10",
      name: "Transfer",
      amount: 100,
      iso_currency_code: "USD",
    };
    const incoming = {
      ...out,
      transaction_id: "in",
      account_id: "s",
      amount: -100,
    };
    f.store.commit(
      "old",
      [{ added: [...rows("a"), out, incoming], modified: [], removed: [] }],
      "oldcursor",
      [],
    );
    const { transferState } = await import("../server/transfers");
    const transfer = transferState(f.store).confirmed[0];
    f.store.repository.writeDecision("transfer_decisions", {
      key: transfer.key,
      status,
    });
    const before = f.store.db.prepare("SELECT * FROM transfer_decisions").all(),
      mappings = f.store.repository.aliases();
    f.rows([
      ...rows("b"),
      { ...out, transaction_id: "newout", account_id: "b" },
      { ...out, transaction_id: "duplicate", account_id: "b" },
    ]);
    const { base } = await imported(f);
    const result = await match(f, base);
    expect(result.review.linkable).toBe(true);
    expect(
      result.review.decisions.some((g: any) => g.kind === "transfer_decisions"),
    ).toBe(true);
    expect(result.response.status).toBe(409);
    expect(result.response.body.error).toMatch(/transfer.*preserv/i);
    expect(
      f.store.db.prepare("SELECT * FROM transfer_decisions").all(),
    ).toEqual(before);
    expect(new AccountLinking(f.store).operations()).toEqual([]);
    expect(
      f.store.repository.aliases().filter((a) => a.source_id === "old"),
    ).toEqual(mappings);
    expect(
      transferState(f.store).confirmed.filter((p) => !p.automatic),
    ).toHaveLength(status === "confirmed" ? 1 : 0);
    await f.post(base + "/cancel");
    expect(
      f.store.db.prepare("SELECT * FROM transfer_decisions").all(),
    ).toEqual(before);
    expect(
      transferState(f.store).confirmed.filter((p) => !p.automatic),
    ).toHaveLength(status === "confirmed" ? 1 : 0);
    f.store.db.close();
  },
);
it("requires distinct nicknames when source/account context is identical before revocation", async () => {
  const f = await fixture();
  f.store.connect("second", "fixture-second", [
    {
      account_id: "other",
      name: "Owner checking",
      type: "depository",
      mask: "1234",
    },
  ]);
  const prepared = await f.post("/data-sources/old/replacements", {
    confirm: true,
  });
  expect(prepared.status).toBe(409);
  expect(prepared.body.error).toMatch(/nickname/i);
  expect(f.calls).toEqual([]);
  await f.post("/data-sources/old/name", { name: "Household membership" });
  const id = await f.prepare(),
    base = `/source-replacements/${id}`;
  const index = (await f.get("/accounts")).body;
  expect(
    index.sources.find((s: any) => s.id === "old").replacementDescription,
  ).toMatch(/Household membership.*Owner checking.*depository/);
  expect(
    index.sources.find((s: any) => s.id === "old").accounts[0],
  ).toMatchObject({ type: "depository", mask: "1234" });
  expect(
    index.sources.find((s: any) => s.id === "old").replacementDescription,
  ).toContain("••1234");
  expect(
    (await f.get("/source-replacements")).body.operations[0].oldDescription,
  ).toContain("Household membership");
  await f.post("/data-sources/second/name", { name: "Household membership" });
  expect((await f.post(base + "/revoke", { confirm: true })).status).toBe(409);
  expect(f.calls).toEqual([]);
  await f.post("/data-sources/second/name", { name: "Other membership" });
  expect((await f.post(base + "/revoke", { confirm: true })).status).toBe(200);
  f.store.db.close();
});
