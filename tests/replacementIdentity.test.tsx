import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import HistoryReplacement, {
  replacementRevocationPrompt,
} from "../web/HistoryReplacement";
it("names account context in preparation controls for same-institution sources", () => {
  const sources = [
    {
      id: "one",
      label: "",
      institution_id: "bank",
      status: "ready",
      replacementDescription:
        "MACU · Unnamed source — Household checking · depository · ••1111",
      accounts: [
        {
          id: "a",
          name: "Household checking",
          type: "depository",
          mask: "1111",
        },
      ],
    },
    {
      id: "two",
      label: "",
      institution_id: "bank",
      status: "ready",
      replacementDescription:
        "MACU · Unnamed source — Savings · depository · ••2222",
      accounts: [
        { id: "b", name: "Savings", type: "depository", mask: "2222" },
      ],
    },
  ];
  const html = renderToStaticMarkup(
    <HistoryReplacement
      api={async () => ({ operations: [] })}
      sources={sources}
      institutions={[{ id: "bank", name: "MACU" }]}
      revision=""
      onRefresh={async () => {}}
      openLink={async () => {}}
      disabled={false}
    />,
  );
  expect(html).toContain("Household checking");
  expect(html).toContain("1111");
  expect(html).toContain("Savings");
  expect(html).toContain("2222");
  expect(html).toContain("depository");
});

it("includes the affected nickname and accounts in the explicit revocation confirmation", () => {
  const description =
    "MACU · Household membership — Owner checking · depository · ••1234; Savings · depository · ••5678";
  const prompt = replacementRevocationPrompt(description);
  expect(prompt).toContain(description);
  expect(prompt).toMatch(/Revoke provider access/);
  expect(prompt).toContain("Saved history stays here");
  expect(prompt).toContain("access may remain unavailable");
});
