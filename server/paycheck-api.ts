import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Store } from "./store";
import type { Plan } from "./bill-plan";
import {
  installPaycheckReview,
  readReviewLedger,
  saveReviewLedger,
  validateReviewLedger,
} from "./paycheck-repository";
import { reviewEvidence } from "./paycheck-evidence";
import { projectReview } from "../shared/paycheckProjection";
import type { ReviewLedger } from "../shared/paycheckReview";
export function installPaycheckApi(app: Express, s: Store, drafts: Plan[]) {
  installPaycheckReview(s);
  const state = () => {
    const ledger = readReviewLedger(s),
      evidence = reviewEvidence(s, drafts),
      asOf = new Date().toISOString().slice(0, 10);
    let invalid = "";
    try {
      validateReviewLedger(s, ledger);
    } catch (e: any) {
      invalid = e.message;
    }
    const projections = ledger.paychecks.map((p) => {
      const r = projectReview(ledger, p.id, asOf);
      const review = ledger.reviews.find((r) => r.paycheckId === p.id);
      if (
        invalid ||
        evidence.issues.length ||
        (review && review.evidenceDigest !== evidence.digest)
      ) {
        r.safeToSpendMinor = null;
        r.leftoverMinor = null;
        r.issues.push({
          code: "EVIDENCE_CHANGED",
          recordId: p.id,
          message:
            invalid ||
            "Bank or plan evidence changed. Confirm this review again.",
        });
      }
      return r;
    });
    return { ledger, evidence, projections, asOf };
  };
  app.get("/api/paycheck-review", (_req, res) => res.json(state()));
  app.post("/api/paycheck-review", (req, res) => {
    try {
      const b = req.body,
        ev = reviewEvidence(s, drafts);
      if (
        !Number.isSafeInteger(b?.expectedRevision) ||
        !Array.isArray(b.changes) ||
        b.changes.length > 50
      )
        return res
          .status(400)
          .json({ error: "Save at most 50 changes at a time." });
      if (b.evidenceDigest !== ev.digest)
        return res
          .status(409)
          .json({
            error: "Bank or plan evidence changed. Reload before saving.",
          });
      const ledger = readReviewLedger(s),
        map: Record<string, string> = {};
      const keys = [
        "sources",
        "paychecks",
        "obligations",
        "contributions",
        "settlements",
        "reviews",
      ] as const;
      for (const c of b.changes) {
        if (
          !keys.includes(c.collection) ||
          !["upsert", "remove"].includes(c.action) ||
          typeof c.id !== "string"
        )
          throw Error("Invalid review change.");
        if (
          c.action === "upsert" &&
          c.id.startsWith("tmp:") &&
          c.collection !== "reviews"
        )
          map[c.id] ??= randomUUID();
      }
      const resolve = (record: any) =>
        Object.fromEntries(
          Object.entries(record).map(([k, v]) => [
            k,
            typeof v === "string" && (k === "id" || k.endsWith("Id"))
              ? (map[v] ?? v)
              : v,
          ]),
        );
      for (const c of b.changes) {
        const collection = c.collection as (typeof keys)[number],
          rows = ledger[collection] as any[],
          id = map[c.id] ?? c.id;
        const key = collection === "reviews" ? "paycheckId" : "id";
        const i = rows.findIndex((r) => r[key] === id);
        if (c.action === "remove") {
          if (i < 0) throw Error("Record not found. Reload.");
          rows.splice(i, 1);
        } else {
          if (
            !c.record ||
            typeof c.record !== "object" ||
            Array.isArray(c.record)
          )
            throw Error("Invalid review record.");
          const r = resolve(c.record);
          if (r[key] !== id) throw Error("Review record ID mismatch.");
          if (collection === "reviews") r.evidenceDigest = ev.digest;
          if (i < 0) rows.push(r);
          else rows[i] = r;
        }
      }
      const saved = saveReviewLedger(s, b.expectedRevision, ledger);
      res.json({ ...state(), ledger: saved, idMap: map });
    } catch (e: any) {
      res
        .status(e.code === "STALE_REVIEW" ? 409 : 400)
        .json({ error: e.message ?? "Review could not be saved." });
    }
  });
}
