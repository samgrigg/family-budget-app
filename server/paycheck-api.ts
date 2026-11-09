import {
  unassignedPurchases,
  unassignedCashDebits,
} from "../shared/reviewPurchases";
import {
  installCardLiabilities,
  readCardLiabilities,
  refreshCardLiabilities,
} from "./card-liabilities";
import type { Provider } from "./plaid";
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
export function installPaycheckApi(
  app: Express,
  s: Store,
  drafts: Plan[],
  provider: Provider,
) {
  installPaycheckReview(s);
  installCardLiabilities(s);
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
    const unassigned = unassignedPurchases(
      ledger,
      evidence.transactions,
      evidence.accounts,
    );
    const unassignedCash = unassignedCashDebits(ledger, evidence.transactions);
    const projections = ledger.paychecks.map((p) => {
      const r = projectReview(ledger, p.id, asOf);
      const review = ledger.reviews.find((r) => r.paycheckId === p.id);
      if (
        invalid ||
        unassignedCash.some((t) => t.paycheckId === p.id) ||
        unassigned.length ||
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
            (unassignedCash.some((t) => t.paycheckId === p.id)
              ? "Account for posted bank debits before using safe to spend."
              : null) ||
            (unassigned.length
              ? "Assign imported card purchases to an obligation before using safe to spend."
              : "Bank or plan evidence changed. Confirm this review again."),
        });
      }
      return r;
    });
    return {
      ledger,
      evidence,
      projections,
      asOf,
      unassignedPurchases: unassigned,
      unassignedCash,
      cardData: readCardLiabilities(s),
      cardSources: [
        ...new Map(
          s.repository
            .accounts()
            .filter((a) => a.type === "credit" && a.shared !== false)
            .map((a) => [
              a.connection,
              {
                id: a.connection,
                name:
                  s.list().find((v) => v.id === a.connection)?.display_name ??
                  a.name,
              },
            ]),
        ).values(),
      ],
    };
  };
  app.post(
    "/api/paycheck-review/card-data/:sourceId/refresh",
    async (req, res) => {
      try {
        await refreshCardLiabilities(s, provider, String(req.params.sourceId));
        res.json({ cardData: readCardLiabilities(s) });
      } catch {
        res.status(400).json({
          error:
            "Card data cannot be refreshed. Confirm the source is connected and account review is complete.",
        });
      }
    },
  );
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
        return res.status(409).json({
          error: "Bank or plan evidence changed. Reload before saving.",
        });
      const ledger = readReviewLedger(s),
        map: Record<string, string> = Object.create(null);
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
      if (b.changes.some((c: any) => c.collection !== "reviews")) {
        const reconfirmed = new Set(
          b.changes
            .filter(
              (c: any) => c.collection === "reviews" && c.action === "upsert",
            )
            .map((c: any) => map[c.id] ?? c.id),
        );
        for (const r of ledger.reviews)
          if (!reconfirmed.has(r.paycheckId)) r.completedAt = null;
      }
      for (const r of ledger.reviews.filter((r) => r.completedAt !== null)) {
        if (
          unassignedCashDebits(ledger, ev.transactions).some(
            (t) => t.paycheckId === r.paycheckId,
          ) ||
          unassignedPurchases(ledger, ev.transactions, ev.accounts).length ||
          ev.issues.length ||
          projectReview(
            ledger,
            r.paycheckId,
            new Date().toISOString().slice(0, 10),
          ).safeToSpendMinor === null
        )
          throw Error(
            "This review still needs information. Save progress without finishing.",
          );
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
