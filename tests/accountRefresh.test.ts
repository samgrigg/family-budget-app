import { expect, it } from "vitest";
import { refreshAccountSources } from "../web/refreshAccounts";
it("refreshes each eligible connection once, continues after failures and reports partial results", async () => {
  const paths: string[] = [];
  const result = await refreshAccountSources(
    async (path, body) => {
      expect(body).toEqual({});
      paths.push(path);
      if (path.includes("broken")) throw Error("Reconnect required");
      return {};
    },
    [
      { id: "bank/a", status: "ready" },
      { id: "bank/a", status: "ready" },
      { id: "broken", status: "ready" },
      { id: "other", status: "ready" },
      { id: "old", status: "historical" },
      { id: "revoked", status: "revoke_required" },
      { id: "missing", status: "ready", missingAccessCredential: true },
      { id: "replacement", status: "ready", replacementPending: true },
    ],
  );
  expect(paths).toEqual([
    "/data-sources/bank%2Fa/sync",
    "/data-sources/broken/sync",
    "/data-sources/other/sync",
  ]);
  expect(result.refreshed).toEqual(["bank/a", "other"]);
  expect(result.failed).toEqual([
    { id: "broken", message: "Reconnect required" },
  ]);
});
it("does not start more refreshes after navigating away", async () => {
  let active = true;
  const paths: string[] = [];
  await refreshAccountSources(
    async (path) => {
      paths.push(path);
      active = false;
    },
    [
      { id: "one", status: "ready" },
      { id: "two", status: "ready" },
    ],
    () => active,
  );
  expect(paths).toEqual(["/data-sources/one/sync"]);
});
