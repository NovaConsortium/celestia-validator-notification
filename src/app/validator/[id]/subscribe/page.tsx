import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fetchValidatorById } from "@/lib/validator-meta";
import { SubscriptionForm } from "@/components/subscription-form";
import { SiteHeader } from "@/components/site-header";
import type { Network } from "@/types/events";

export const revalidate = 60;

interface SubscribePageProps {
  params: { id: string };
  searchParams?: { network?: string };
}

export default async function SubscribePage({
  params,
  searchParams,
}: SubscribePageProps): Promise<JSX.Element> {
  const network: Network =
    searchParams?.network === "testnet" ? "testnet" : "mainnet";
  const validator = await fetchValidatorById(params.id, network);
  if (!validator) notFound();

  return (
    <main className="relative pt-3">
      <div className="glow-field" aria-hidden="true" />

      <SiteHeader network={network} />

      <div className="relative z-10 mx-auto max-w-[820px] px-4 pb-20 md:px-6">
        <Link
          href={`/validator/${encodeURIComponent(validator.id)}?network=${network}`}
          className="group mt-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 ease-out-quint group-hover:-translate-x-0.5" />
          Back to validator
        </Link>

        <header className="mb-9 mt-4 flex items-center gap-4">
          <ValidatorLogo src={validator.logo} name={validator.name ?? validator.id} />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-micro text-muted-foreground">
              Set up notifications · {network}
            </p>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-editorial md:text-3xl">
              {validator.name ?? `Validator ${validator.id}`}
            </h1>
          </div>
        </header>

        <SubscriptionForm validatorId={validator.id} network={network} />
      </div>
    </main>
  );
}

function ValidatorLogo({ src, name }: { src?: string; name: string }): JSX.Element {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  if (!src) {
    return (
      <div
        aria-hidden="true"
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-2xl font-bold text-primary ring-1 ring-inset ring-primary/25"
      >
        {initial}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={64}
      height={64}
      className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-inset ring-border"
      referrerPolicy="no-referrer"
    />
  );
}
