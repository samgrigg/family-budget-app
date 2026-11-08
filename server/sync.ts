import type { Store } from "./store";
const locks = new WeakMap<Store, Set<string>>();
export async function syncConnection(
  store: Store,
  id: string,
  fetchPage: (cursor?: string) => Promise<any>,
  accounts: any[] = [],
  authoritativeAccounts = false,
) {
  let set = locks.get(store);
  if (!set) locks.set(store, (set = new Set()));
  if (set.has(id)) throw Error("Import already running");
  set.add(id);
  try {
    const connection = store.connection(id);
    if (!connection.token || connection.status === "historical")
      throw Object.assign(Error("Source is disconnected"), {
        code: "DISCONNECTED",
      });
    const start = connection.cursor ?? undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      let cursor = start;
      const pages: any[] = [];
      try {
        for (let n = 0; n < 1000; n++) {
          const p = await fetchPage(cursor);
          pages.push(p);
          cursor = p.next_cursor;
          if (!p.has_more) {
            store.commit(id, pages, cursor!, accounts, authoritativeAccounts);
            return;
          }
        }
        throw Error("Import page limit exceeded");
      } catch (e: any) {
        if (
          e.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" ||
          attempt === 2
        )
          throw e;
      }
    }
  } finally {
    set.delete(id);
  }
}
