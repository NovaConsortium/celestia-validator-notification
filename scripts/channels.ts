import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function maskConfig(type: string, cfg: any): string {
  if (!cfg) return "{}";
  switch (type) {
    case "discord":
    case "slack": {
      const url: string = cfg.webhookUrl ?? "";
      return `webhook=${url ? url.slice(0, 30) + "…" : "(none)"}`;
    }
    case "telegram":
      return `chatId=${cfg.chatId ?? "(none)"}${cfg.chatTitle ? ` (${cfg.chatTitle})` : ""}`;
    case "pagerduty":
      return `routingKey=${cfg.routingKey ? "***set***" : "(none)"}`;
    case "sms":
    case "voice":
      return `to=${cfg.to ?? cfg.phone ?? "(none)"}`;
    default:
      return JSON.stringify(Object.keys(cfg));
  }
}

async function main() {
  const channels = await db.channel.findMany({
    include: {
      subscription: {
        select: {
          walletAddress: true,
          validatorId: true,
          network: true,
        },
      },
    },
    orderBy: { type: "asc" },
  });

  console.log(`Total channels: ${channels.length}\n`);
  for (const c of channels) {
    const s = c.subscription;
    console.log(
      `[${c.type}] enabled=${c.enabled} ` +
        `${s.network}:${s.validatorId} ` +
        `wallet=${s.walletAddress.slice(0, 10)}…`,
    );
    console.log(`   events: ${JSON.stringify(c.events)}`);
    console.log(`   config: ${maskConfig(c.type, c.config as any)}`);
    if (c.lastErrorAt) {
      console.log(`   lastError(${c.lastErrorAt.toISOString()}): ${c.lastErrorMsg}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
