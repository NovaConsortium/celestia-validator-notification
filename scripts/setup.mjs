#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function step(msg) {
  console.log(`\n${BOLD}▶ ${msg}${RESET}`);
}

function fail(msg) {
  console.error(`\n${RED}${BOLD}✖ ${msg}${RESET}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`${GREEN}✓ ${msg}${RESET}`);
}

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

step("Checking .env");

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) fail(".env.example missing — broken repo");
  copyFileSync(examplePath, envPath);
  console.log(`${YELLOW}.env created from .env.example${RESET}`);
  console.log(
    `\n${YELLOW}${BOLD}Fill in these required vars in .env, then re-run \`npm run setup\`:${RESET}`,
  );
  console.log("  DATABASE_URL              # external Postgres");
  console.log("  TELEGRAM_BOT_TOKEN");
  console.log("  TELEGRAM_BOT_USERNAME");
  console.log("  PUBLIC_URL                # http://localhost:3000 for dev");
  console.log("  CHANNEL_ENCRYPTION_KEY    # 64-char hex (see below)");
  console.log("\nGenerate encryption key:");
  console.log(
    `  ${BOLD}node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"${RESET}\n`,
  );
  process.exit(1);
}

const env = readFileSync(envPath, "utf8");
const required = [
  "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "PUBLIC_URL",
  "CHANNEL_ENCRYPTION_KEY",
];

const missing = required.filter((k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return !m || !m[1].trim();
});

if (missing.length) {
  console.log(`${YELLOW}.env exists but missing values for:${RESET}`);
  for (const k of missing) console.log(`  - ${k}`);
  console.log(
    `\nFill them in then re-run ${BOLD}npm run setup${RESET}\n`,
  );
  process.exit(1);
}

ok(".env populated");

step("Checking optional wallet-auth vars");
const optional = [
  ["SESSION_SECRET", "32+ char random string. Required for /api/auth/* routes."],
  ["NEXT_PUBLIC_WC_PROJECT_ID", "WalletConnect Cloud projectId for mobile wallets."],
  ["RESEND_API_KEY", "Resend send-only key. Required for email alerts + email OTP."],
];
const missingOptional = optional.filter(([k]) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return !m || !m[1].trim();
});
if (missingOptional.length) {
  console.log(`${YELLOW}Optional (only needed for wallet connect):${RESET}`);
  for (const [k, hint] of missingOptional) {
    console.log(`  - ${k}  ${hint}`);
  }
  console.log(
    `\nGenerate SESSION_SECRET:\n  ${BOLD}node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"${RESET}\n`,
  );
}

step("Installing deps");
run("npm install");
ok("deps installed");

step("Running Prisma migrations");
try {
  run("npx prisma migrate dev --name init --skip-seed");
  ok("migrations applied");
} catch {
  fail("Prisma migrate failed — check DATABASE_URL is reachable");
}

step("Seeding database");
run("npx prisma db seed");
ok("seeded");

console.log(`\n${GREEN}${BOLD}✓ Setup complete.${RESET}`);
console.log(`\nNext: ${BOLD}npm run dev${RESET} (web + worker + bot)\n`);
