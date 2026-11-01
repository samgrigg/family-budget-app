import { describe, it, expect } from "vitest";
import { Store } from "../server/store";
import { syncConnection } from "../server/sync";
const key = Buffer.alloc(32, 7);
const tx = (id = "t1", amount = 12.34) => ({
  transaction_id: id,
  account_id: "a1",
  date: "2026-10-01",
  name: "Groceries",
  amount,
  iso_currency_code: "USD",
  pending: false,
});
const page = (added: any[] = [], extra: any = {}) => ({
  added,
  modified: [],
  removed: [],
  next_cursor: "c1",
  has_more: false,
  transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
  ...extra,
});
function setup(env = "sandbox") {
  const s = new Store(":memory:", key, env);
  s.connect("i1", "secret-access-token", []);
  return s;
}
describe("durable import", () => {
  it("encrypts tokens and isolates environments", () => {
    const s = setup();
    expect(JSON.stringify(s.list())).not.toContain("secret-access-token");
    expect(s.db.prepare("select token from connections").get()).not.toEqual({
      token: "secret-access-token",
    });
    expect(s.token("i1")).toBe("secret-access-token");
    const p = new Store(s.db, key, "production");
    expect(p.list()).toEqual([]);
    s.db.close();
  });
  it("repeated sync upserts, modifies and removes", async () => {
    const s = setup();
    await syncConnection(s, "i1", async () => page([tx()]));
    await syncConnection(s, "i1", async () => page([tx()]));
    expect(s.transactions()).toHaveLength(1);
    await syncConnection(s, "i1", async () =>
      page([], { modified: [tx("t1", 4.56)] }),
    );
    expect(s.transactions()[0].amount).toBe("4.56");
    await syncConnection(s, "i1", async () =>
      page([], { removed: [{ transaction_id: "t1" }] }),
    );
    expect(s.transactions()).toHaveLength(0);
    s.db.close();
  });
  it("does not commit partial pages on failure", async () => {
    const s = setup();
    let n = 0;
    await expect(
      syncConnection(s, "i1", async () => {
        if (n++) throw Error("offline");
        return page([tx()], { has_more: true });
      }),
    ).rejects.toThrow();
    expect(s.transactions()).toHaveLength(0);
    expect(s.connection("i1").cursor).toBeNull();
    s.db.close();
  });
  it("restarts from original cursor after pagination mutation", async () => {
    const s = setup();
    const cursors: any[] = [];
    let n = 0;
    await syncConnection(s, "i1", async (cursor) => {
      cursors.push(cursor);
      if (n++ === 1)
        throw Object.assign(Error(), {
          code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
        });
      return page([tx()], { has_more: n === 1 });
    });
    expect(cursors).toEqual([undefined, "c1", undefined]);
    expect(s.transactions()).toHaveLength(1);
    s.db.close();
  });
  it("removes pending counterpart when a posted transaction arrives", async () => {
    const s = setup();
    await syncConnection(s, "i1", async () =>
      page([{ ...tx("pending"), pending: true }]),
    );
    await syncConnection(s, "i1", async () =>
      page([{ ...tx("posted"), pending_transaction_id: "pending" }]),
    );
    expect(s.transactions().map((t: any) => t.id)).toEqual(["posted"]);
    s.db.close();
  });
  it("blocks overlapping imports", async () => {
    const s = setup();
    let release: any;
    const first = syncConnection(
      s,
      "i1",
      () => new Promise((r) => (release = r)),
    );
    await expect(syncConnection(s, "i1", async () => page())).rejects.toThrow(
      "already",
    );
    release(page());
    await first;
    s.db.close();
  });
});
