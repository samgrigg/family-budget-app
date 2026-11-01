import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env already exists; left unchanged.");
} else {
  const template = readFileSync(".env.example", "utf8");
  writeFileSync(
    ".env",
    template.replace(
      "TOKEN_ENCRYPTION_KEY=\n",
      `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created private .env with a random encryption key. Add your Plaid client ID and sandbox secret locally.",
  );
}
