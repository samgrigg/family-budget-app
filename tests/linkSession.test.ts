import { it, expect } from "vitest";
import {
  saveLinkAction,
  readLinkAction,
  cancelLinkAction,
  completeLinkAction,
  type LinkAction,
} from "../web/linkSession";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
}
function action(): Extract<LinkAction, { mode: "repair" | "select_accounts" }> {
  return {
    mode: "select_accounts",
    sourceId: "existing/source",
    environment: "sandbox",
    phase: "link",
    linkToken: "synthetic-link",
    expiresAt: Date.now() + 10000,
  };
}
it("OAuth resume retains update action and source instead of treating the callback as a new connection", async () => {
  const s = storage();
  saveLinkAction(s, action());
  const resumed = readLinkAction(s, "sandbox")!;
  const paths: string[] = [];
  await completeLinkAction(
    s,
    resumed,
    "unused-public",
    async (path: string, body: any) => {
      paths.push(path);
      expect(body).toEqual({});
    },
  );
  expect(paths).toEqual([
    "/data-sources/existing%2Fsource/authorization-complete",
  ]);
  expect(readLinkAction(s, "sandbox")).toBeNull();
});
it("failed verification retains resumable context without the Link token and retries safely", async () => {
  const s = storage();
  saveLinkAction(s, action());
  await expect(
    completeLinkAction(s, action(), "unused", async () => {
      throw Error("Provider unavailable");
    }),
  ).rejects.toThrow("unavailable");
  const pending = readLinkAction(s, "sandbox")!;
  expect(pending.phase).toBe("verify");
  expect(pending.linkToken).toBeUndefined();
  await completeLinkAction(s, pending, "", async () => ({}));
  expect(readLinkAction(s, "sandbox")).toBeNull();
});
it("cancellation clears the resumable action without changing source access or exchanging tokens", () => {
  const s = storage();
  saveLinkAction(s, action());
  cancelLinkAction(s);
  expect(readLinkAction(s, "sandbox")).toBeNull();
});
it("rejects expired OAuth tokens and different environments while preserving verification retries", () => {
  const s = storage();
  saveLinkAction(s, { ...action(), expiresAt: 0 });
  expect(() => readLinkAction(s, "sandbox")).toThrow("expired");
  saveLinkAction(s, action());
  expect(() => readLinkAction(s, "production")).toThrow("environment");
  saveLinkAction(s, {
    ...action(),
    phase: "verify",
    linkToken: undefined,
    expiresAt: 0,
  });
  expect(readLinkAction(s, "sandbox")!.phase).toBe("verify");
});
it("replacement OAuth context keeps operation ID and exchanges only through its operation", async () => {
  const s = storage(),
    a = {
      ...action(),
      mode: "replacement" as const,
      operationId: "replace/id",
    };
  saveLinkAction(s, a);
  expect(readLinkAction(s, "sandbox")!.operationId).toBe("replace/id");
  const paths: string[] = [];
  await completeLinkAction(s, a, "fixture-public", async (path, body) => {
    paths.push(path);
    expect(body.public_token).toBe("fixture-public");
  });
  expect(paths).toEqual(["/source-replacements/replace%2Fid/exchange"]);
  expect(readLinkAction(s, "sandbox")).toBeNull();
});
