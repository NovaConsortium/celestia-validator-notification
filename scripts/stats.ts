import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const subs = await db.subscription.findMany({
    include: {
      validator: { select: { id: true, network: true, name: true } },
      channels: { select: { type: true, enabled: true, events: true } },
    },
  });

  const wallets = new Set(subs.map((s) => s.walletAddress.toLowerCase()));
  const validators = new Set(subs.map((s) => `${s.network}:${s.validatorId}`));
  const validatorNames = new Map<string, string>();
  for (const s of subs) {
    const key = `${s.network}:${s.validatorId}`;
    validatorNames.set(key, s.validator.name ?? "(unnamed)");
  }

  const alertCounts: Record<string, number> = {
    slotSkip: 0,
    offline: 0,
    delegation: 0,
    commission: 0,
  };
  const channelTypeCount: Record<string, number> = {};
  const channelEnabledCount: Record<string, number> = {};
  const perWallet: Record<string, { subs: number; validators: Set<string> }> = {};

  for (const s of subs) {
    const cfg = s.alertConfig as any;
    if (cfg?.slotSkip) alertCounts.slotSkip++;
    if ((cfg?.offlineAfterN ?? 0) > 0) alertCounts.offline++;
    if (cfg?.delegation) alertCounts.delegation++;
    if (cfg?.commission) alertCounts.commission++;

    const w = s.walletAddress.toLowerCase();
    perWallet[w] ??= { subs: 0, validators: new Set() };
    perWallet[w].subs++;
    perWallet[w].validators.add(`${s.network}:${s.validatorId}`);

    for (const ch of s.channels) {
      channelTypeCount[ch.type] = (channelTypeCount[ch.type] ?? 0) + 1;
      if (ch.enabled) {
        channelEnabledCount[ch.type] = (channelEnabledCount[ch.type] ?? 0) + 1;
      }
    }
  }

  console.log("=== Totals ===");
  console.log("Unique wallets:", wallets.size);
  console.log("Unique validators tracked:", validators.size);
  console.log("Total subscriptions:", subs.length);

  console.log("\n=== Alerts enabled (across subs) ===");
  for (const [k, v] of Object.entries(alertCounts)) console.log(`  ${k}: ${v}`);

  console.log("\n=== Channels (total / enabled) ===");
  for (const t of Object.keys(channelTypeCount)) {
    console.log(`  ${t}: ${channelTypeCount[t]} total, ${channelEnabledCount[t] ?? 0} enabled`);
  }

  console.log("\n=== Validators tracked ===");
  for (const key of validators) {
    console.log(`  ${key} — ${validatorNames.get(key)}`);
  }

  console.log("\n=== Per-wallet ===");
  for (const [w, info] of Object.entries(perWallet)) {
    const list = [...info.validators]
      .map((k) => `${k} (${validatorNames.get(k)})`)
      .join(", ");
    console.log(`  ${w}: ${info.subs} subs — ${list}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
