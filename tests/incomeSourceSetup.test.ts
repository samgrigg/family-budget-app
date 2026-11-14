import { it, expect } from "vitest";
import { saveIncomeSource } from "../web/saveIncomeSource";
import { fundedLedger } from "./paycheck-fixtures";
it("saves a source immediately without saving unrelated draft edits", async () => {
  const saved = fundedLedger(),
    draft = structuredClone(saved);
  draft.paychecks[0].nextPayday = "2026-11-21";
  const record = {
    id: "tmp:adobe",
    name: "Adobe",
    accountId: "etrade",
    incomeKey: null,
  };
  const api = async (path: string, body: any) => {
    expect(path).toBe("/paycheck-review");
    expect(body).toEqual({
      expectedRevision: 0,
      evidenceDigest: "evidence",
      changes: [
        { collection: "sources", action: "upsert", id: "tmp:adobe", record },
      ],
    });
    return {
      ledger: {
        ...saved,
        revision: 1,
        sources: [...saved.sources, { ...record, id: "adobe" }],
      },
      evidence: { digest: "evidence" },
      idMap: { "tmp:adobe": "adobe" },
    };
  };
  const result = await saveIncomeSource(
    api,
    { ledger: saved, evidence: { digest: "evidence" } },
    draft,
    record,
  );
  expect(result.ledger.sources[1].id).toBe("adobe");
  expect(result.ledger.paychecks[0].nextPayday).toBe("2026-11-21");
  expect(result.data.ledger.paychecks[0].nextPayday).toBe("2026-11-20");
});
it("surfaces a failed save rather than reporting a draft source as saved", async () => {
  const l = fundedLedger();
  await expect(
    saveIncomeSource(
      async () => {
        throw Error("Reload before saving.");
      },
      { ledger: l, evidence: { digest: "x" } },
      l,
      l.sources[0],
    ),
  ).rejects.toThrow(/Reload/);
});
