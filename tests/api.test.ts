import { it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app";
import { Store } from "../server/store";
it("requires same origin and CSRF and never returns access tokens", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  const provider: any = {
    configured: true,
    call: async (path: string) =>
      path === "/item/public_token/exchange"
        ? { item_id: "i1", access_token: "private-token" }
        : { accounts: [] },
  };
  const app = createApp(s, provider, "http://localhost:3000");
  expect(
    (await request(app).post("/api/connect").send({ public_token: "x" }))
      .status,
  ).toBe(403);
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const cookie = session.headers["set-cookie"];
  const r = await request(app)
    .post("/api/connect")
    .set("Host", "localhost:3000")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", cookie)
    .set("X-CSRF-Token", session.body.csrf)
    .send({ public_token: "x" });
  expect(r.status).toBe(200);
  expect(JSON.stringify(r.body)).not.toContain("private-token");
  expect(
    (await request(app).get("/api/state").set("Host", "evil.test")).status,
  ).toBe(403);
  s.db.close();
});
it("keeps the connection when provider revocation fails", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("i1", "private-token", []);
  const app = createApp(
    s,
    {
      configured: true,
      call: async () => {
        throw Error("sensitive upstream details");
      },
    },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const r = await request(app)
    .post("/api/connections/i1/disconnect")
    .set("Host", "localhost:3000")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", session.headers["set-cookie"])
    .set("X-CSRF-Token", session.body.csrf)
    .send({});
  expect(r.status).toBe(502);
  expect(s.list()).toHaveLength(1);
  expect(JSON.stringify(r.body)).not.toContain("sensitive upstream details");
  s.db.close();
});
it("revokes the exchanged token if local persistence fails", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  const calls: string[] = [];
  const app = createApp(
    s,
    {
      configured: true,
      call: async (path) => {
        calls.push(path);
        return { item_id: "i1", access_token: "private-token" };
      },
    },
    "http://localhost:3000",
  );
  s.connect = () => {
    throw Error("disk full");
  };
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  await request(app)
    .post("/api/connect")
    .set("Host", "localhost:3000")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", session.headers["set-cookie"])
    .set("X-CSRF-Token", session.body.csrf)
    .send({ public_token: "x" });
  expect(calls).toEqual(["/item/public_token/exchange", "/item/remove"]);
  s.db.close();
});
it("retains an in-memory revocation handle if both saving and cleanup fail", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  let removals = 0;
  const app = createApp(
    s,
    {
      configured: true,
      call: async (path) => {
        if (path === "/item/remove" && removals++ === 0) throw Error("offline");
        return { item_id: "i1", access_token: "private-token" };
      },
    },
    "http://localhost:3000",
  );
  s.connect = () => {
    throw Error("disk full");
  };
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const post = (path: string) =>
    request(app)
      .post(path)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf);
  const failed = await post("/api/connect").send({ public_token: "x" });
  expect(failed.body.connections[0].status).toBe("revoke_required");
  const management = await request(app)
    .get("/api/accounts")
    .set("Host", "localhost:3000");
  expect(management.body.sources[0]).toMatchObject({
    status: "revoke_required",
    missingAccessCredential: 0,
    recoveryOnly: true,
  });
  expect(JSON.stringify(management.body)).not.toContain("private-token");
  expect(JSON.stringify(failed.body)).not.toContain("private-token");
  const retried = await post("/api/connections/i1/disconnect").send({});
  expect(retried.status).toBe(200);
  expect(retried.body.connections).toEqual([]);
  s.db.close();
});

it("validates institution renaming and returns the saved label", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("i1", "private-token", []);
  const app = createApp(
    s,
    { configured: true, call: async () => ({}) },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const rename = (id: string, name: string) =>
    request(app)
      .post(`/api/connections/${id}/name`)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send({ name });
  expect((await rename("i1", "  ")).status).toBe(400);
  expect((await rename("missing", "Bank")).status).toBe(404);
  const result = await rename("i1", " Household bank ");
  expect(result.status).toBe(200);
  expect(result.body.connections[0].display_name).toBe("Household bank");
  expect(JSON.stringify(result.body)).not.toContain("private-token");
  s.db.close();
});

it("supports income review decisions through the protected API", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("i1", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
  ]);
  const today = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1),
    );
    s.db
      .prepare("INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        s.env,
        "i1",
        String(i),
        "a",
        d.toISOString().slice(0, 10),
        "Employer payroll",
        "-1000",
        "USD",
        0,
      );
  }
  const app = createApp(
    s,
    { configured: true, call: async () => ({}) },
    "http://localhost:3000",
  );
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const initial = await request(app)
    .get("/api/income")
    .set("Host", "localhost:3000");
  expect(initial.body.suggestions).toHaveLength(1);
  const b = initial.body.suggestions[0];
  const decide = (status: string) =>
    request(app)
      .post("/api/income")
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send({ key: b.key, name: "Salary", status });
  expect((await decide("invalid")).status).toBe(400);
  expect((await decide("saved")).status).toBe(200);
  const confirmed = await request(app)
    .get("/api/income")
    .set("Host", "localhost:3000");
  expect(confirmed.body.saved[0].name).toBe("Salary");
  expect((await decide("review")).status).toBe(200);
  expect((await decide("dismissed")).status).toBe(200);
  s.db.close();
});

import { groupKey, billState } from "../server/bills";
import { incomeState } from "../server/income";
import { transferCandidates, transferState } from "../server/transfers";
it("undoes migrated bills/income and reconsiders migrated transfers without resurrecting legacy decisions", async () => {
  const s = new Store(":memory:", Buffer.alloc(32), "sandbox");
  s.connect("c", "token", [
    { account_id: "a", name: "Checking", type: "depository" },
    { account_id: "b", name: "Savings", type: "depository" },
  ]);
  const app = createApp(
    s,
    {
      configured: true,
      call: async () => {
        throw Error("No provider call expected");
      },
    } as any,
    "http://localhost:3000",
  );
  const put = s.db.prepare(
    "INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)",
  );
  for (let i = 0; i < 3; i++) {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - i);
    for (const [name, amount] of [
      ["Power", "30"],
      ["Employer payroll", "-100"],
    ])
      put.run(
        s.env,
        "c",
        name + i,
        "a",
        date.toISOString().slice(0, 10),
        name,
        amount,
        "USD",
        0,
      );
  }
  for (const [id, account, amount] of [
    ["out", "a", "50"],
    ["in", "b", "-50"],
  ])
    put.run(
      s.env,
      "c",
      id,
      account,
      new Date().toISOString().slice(0, 10),
      "Transfer",
      amount,
      "USD",
      0,
    );
  const raw = s.db.prepare("SELECT * FROM transactions").all() as any[];
  const oldBill = groupKey(raw.find((t) => t.name === "Power"));
  const oldIncome = groupKey(raw.find((t) => t.name === "Employer payroll"));
  s.db
    .prepare("INSERT INTO bills VALUES(?,?,?,?,?)")
    .run(s.env, oldBill, "Power", "saved", '["removed-evidence"]');
  incomeState(s);
  s.db
    .prepare("INSERT INTO income_decisions VALUES(?,?,?,?)")
    .run(s.env, oldIncome, "Salary", "saved");
  const projection = s.db
    .prepare(
      "SELECT t.id,t.connection,t.account,t.date,t.name,t.amount,t.currency,t.pending,at.type AS account_type FROM transactions t JOIN accounts a ON a.env=t.env AND a.connection=t.connection AND a.id=t.account LEFT JOIN account_types at ON at.env=t.env AND at.connection=t.connection AND at.account=t.account WHERE t.env=? ORDER BY t.connection,t.id",
    )
    .all(s.env);
  const oldTransfer = transferCandidates(projection)[0].key;
  transferState(s);
  s.db
    .prepare("INSERT INTO transfer_decisions VALUES(?,?,?)")
    .run(s.env, oldTransfer, "confirmed");
  const session = await request(app)
    .get("/api/state")
    .set("Host", "localhost:3000");
  const post = (path: string, body: any) =>
    request(app)
      .post(path)
      .set("Host", "localhost:3000")
      .set("Origin", "http://localhost:3000")
      .set("Cookie", session.headers["set-cookie"])
      .set("X-CSRF-Token", session.body.csrf)
      .send(body);
  const bill = billState(s, 6).saved[0],
    income = incomeState(s).saved[0],
    pair = transferState(s).confirmed[0];
  expect(
    (
      await post("/api/bills", {
        key: bill.key,
        name: bill.name,
        status: "review",
      })
    ).status,
  ).toBe(200);
  expect(billState(s, 6).saved).toHaveLength(0);
  expect(
    (
      await post("/api/income", {
        key: income.key,
        name: income.name,
        status: "review",
      })
    ).status,
  ).toBe(200);
  expect(incomeState(s).saved).toHaveLength(0);
  expect(
    (await post("/api/transfers", { key: pair.key, status: "rejected" }))
      .status,
  ).toBe(200);
  expect(transferState(s).confirmed).toHaveLength(0);
  expect(transferState(s).rejected).toHaveLength(1);
  expect(
    (await post("/api/transfers", { key: pair.key, status: "review" })).status,
  ).toBe(200);
  expect(transferState(s).rejected).toHaveLength(0);
  expect(transferState(s).confirmed[0].automatic).toBe(true);
  const archive = s.db.prepare("SELECT * FROM decision_history").all() as any[];
  expect(archive.find((d) => d.legacy_key === oldBill).payload).toContain(
    "removed-evidence",
  );
  expect(archive.some((d) => d.legacy_key === oldIncome)).toBe(true);
  expect(archive.some((d) => d.legacy_key === oldTransfer)).toBe(true);
  s.db.close();
});
