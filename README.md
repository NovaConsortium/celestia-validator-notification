# Celestia Validator Notification Dashboard

A public, self-hosted dashboard where Celestia validator operators browse the
active validator set, pick their validator, and configure notifications across
Discord, Telegram, Slack, PagerDuty, and email for **missed-block, offline, and
recovered** events.

Detection runs off Celenium's block stream plus CometBFT commit data.
Subscriptions are owned by a connected wallet and managed at `/my-alerts` from
any device.

## Stack

- Next.js 14 (App Router, TypeScript, Tailwind, shadcn/ui)
- Postgres (external) + Prisma
- Standalone Node monitoring worker
- Standalone Telegram bot (grammy)
- Resend for transactional email
- Data from Celenium + CometBFT RPC

## Setup

```bash
npm install
cp .env.example .env        # then fill in the values
npx prisma migrate deploy   # apply migrations (needs DATABASE_URL)
npm run dev                 # web + worker + bot
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Web, worker, and bot together (hot reload) |
| `npm run build` | Production build |
| `npm start` | Migrate + run web, worker, bot |
| `npm test` | Run tests (vitest) |
| `npm run lint` | Lint |

See `CLAUDE.md` for architecture, conventions, and the full env var reference.
