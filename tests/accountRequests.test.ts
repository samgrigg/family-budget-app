import { it, expect } from "vitest";
import {
  createRequestGate,
  loadAccountView,
  accountAmount,
  appendAccountPage,
  saveAccountPreferences,
} from "../web/accountRequests";
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
it("ignores account A completion after navigating to B, including mutation/page guards", async () => {
  const a = deferred(),
    b = deferred(),
    gateA = createRequestGate(),
    gateB = createRequestGate();
  const rendered: any[] = [];
  const first = loadAccountView(
    (p) => (p === "/accounts" ? Promise.resolve({}) : a.promise),
    "A",
    gateA,
    (v) => rendered.push(v.detail.account.id),
    (e) => {
      throw e;
    },
  );
  const pendingAction = gateA.active;
  gateA.dispose();
  const second = loadAccountView(
    (p) => (p === "/accounts" ? Promise.resolve({}) : b.promise),
    "B",
    gateB,
    (v) => rendered.push(v.detail.account.id),
    (e) => {
      throw e;
    },
  );
  b.resolve({ account: { id: "B" } });
  await second;
  a.resolve({ account: { id: "A" } });
  await first;
  expect(rendered).toEqual(["B"]);
  expect(pendingAction()).toBe(false);
});
it("refreshes same account after import without older responses overwriting new state", async () => {
  const old = deferred(),
    fresh = deferred(),
    gate = createRequestGate(),
    rendered: any[] = [];
  const first = loadAccountView(
    (p) =>
      p === "/accounts"
        ? old.promise
        : Promise.resolve({ account: { id: "A" } }),
    "A",
    gate,
    (v) => rendered.push(v.index),
    (e) => {
      throw e;
    },
  );
  const refresh = loadAccountView(
    (p) =>
      p === "/accounts"
        ? fresh.promise
        : Promise.resolve({ account: { id: "A" } }),
    "A",
    gate,
    (v) => rendered.push(v.index),
    (e) => {
      throw e;
    },
  );
  fresh.resolve({ sources: [{ status: "ready" }] });
  await refresh;
  old.resolve({ sources: [{ status: "waiting" }] });
  await first;
  expect(rendered).toEqual([{ sources: [{ status: "ready" }] }]);
});
it("rejects a mismatched detail identity and formats USD without losing other currency labels", async () => {
  let accepted = false,
    error = "";
  await loadAccountView(
    (p) =>
      Promise.resolve(p === "/accounts" ? {} : { account: { id: "wrong" } }),
    "A",
    createRequestGate(),
    () => {
      accepted = true;
    },
    (e) => {
      error = e.message;
    },
  );
  expect(accepted).toBe(false);
  expect(error).toContain("did not match");
  expect(accountAmount("USD", "-80")).toBe("+$80.00");
  expect(accountAmount("CAD", "80")).toBe("−CAD 80.00");
});

it("cannot append a late page or save mismatched account values after navigation", async () => {
  const page = deferred(),
    gate = createRequestGate(),
    rendered: any[] = [];
  const pending = appendAccountPage(
    () => page.promise,
    { account: { id: "A" }, nextCursor: "next", transactions: [{ id: "one" }] },
    gate,
    (v) => rendered.push(v),
  );
  gate.dispose();
  page.resolve({ account: { id: "A" }, transactions: [{ id: "two" }] });
  await pending;
  expect(rendered).toEqual([]);
  const calls: any[] = [];
  const api = async (path: string, body: any) => {
    calls.push({ path, body });
  };
  await expect(
    saveAccountPreferences(api, "B", "A", createRequestGate(), {
      name: "A name",
      included: true,
    }),
  ).rejects.toThrow("page changed");
  await expect(
    saveAccountPreferences(api, "A", "A", gate, {
      name: "A name",
      included: true,
    }),
  ).rejects.toThrow("page changed");
  expect(calls).toEqual([]);
  await saveAccountPreferences(api, "B", "B", createRequestGate(), {
    name: "B name",
    included: false,
  });
  expect(calls).toEqual([
    {
      path: "/accounts/B/preferences",
      body: { name: "B name", included: false },
    },
  ]);
});

it("displays deposits and refunds as positive and spending as negative without changing stored values", () => {
  const deposit = { amount: "-2500.5" };
  expect(accountAmount("USD", deposit.amount)).toBe("+$2,500.50");
  expect(accountAmount("USD", "42.5")).toBe("−$42.50");
  expect(accountAmount("USD", "-12")).toBe("+$12.00");
  expect(accountAmount("USD", "0")).toBe("$0.00");
  expect(accountAmount("USD", "-0")).toBe("$0.00");
  expect(deposit.amount).toBe("-2500.5");
});
