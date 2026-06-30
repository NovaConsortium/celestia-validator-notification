import Image from "next/image";
import Link from "next/link";
import type { Network } from "@/types/events";
import { ConnectButton } from "@/components/wallet/connect-button";
import { ThemeToggle } from "@/components/theme-toggle";

interface SiteHeaderProps {
  network?: Network;
}

export function SiteHeader({ network }: SiteHeaderProps): JSX.Element {
  return (
    <header className="sticky top-3 z-40 mx-auto max-w-[1320px] px-4 md:px-6">
      <div className="glass flex items-center justify-between gap-4 rounded-2xl px-3 py-2.5 md:px-4">
        <Link
          href="/"
          className="group flex items-center gap-3"
          aria-label="Nova Consortium home"
        >
          <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl">
            <span className="absolute inset-0 bg-primary/15 blur-md transition-opacity duration-300 group-hover:opacity-100 opacity-70" />
            <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-primary/30" />
            <Image
              src="/nova.png"
              alt=""
              width={40}
              height={40}
              priority
              className="relative h-full w-full rounded-xl object-cover"
            />
          </span>
          <Image
            src="/Logo_type_-_white_purple.png"
            alt="Nova Consortium"
            width={2706}
            height={850}
            priority
            className="h-8 w-auto"
          />
        </Link>

        <div className="flex items-center gap-2 md:gap-2.5">
          {network ? (
            <span className="hidden items-center gap-2 rounded-full border border-border/70 bg-background/40 px-3 py-1.5 text-[10px] uppercase tracking-micro text-muted-foreground sm:inline-flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success/70 [animation:pulse-ring_1.8s_ease-out_infinite]" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              {network}
            </span>
          ) : null}
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
