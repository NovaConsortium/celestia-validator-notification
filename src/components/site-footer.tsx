import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";

const SOCIALS: ReadonlyArray<{
  href: string;
  label: string;
  icon: JSX.Element;
}> = [
  {
    href: "https://t.me/luoklhi",
    label: "Telegram",
    icon: <TelegramIcon />,
  },
  {
    href: "https://x.com/NovaConsortium",
    label: "X",
    icon: <XIcon />,
  },
  {
    href: "mailto:contact@novaconsortium.org",
    label: "Email",
    icon: <Mail className="h-5 w-5" strokeWidth={1.6} />,
  },
];

export function SiteFooter(): JSX.Element {
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 mt-16">
      <div className="mx-auto max-w-[1320px] px-4 pb-6 md:px-6">
        <div className="panel flex flex-col gap-5 rounded-2xl px-5 py-5 md:flex-row md:items-center md:justify-between md:px-7 md:py-6">
          <Link
            href="/"
            className="group flex items-center gap-3"
            aria-label="Nova Consortium home"
          >
            <span className="relative inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl ring-1 ring-inset ring-primary/25">
              <Image
                src="/nova.png"
                alt=""
                width={44}
                height={44}
                className="h-full w-full object-cover"
              />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-editorial text-foreground">
                Nova Consortium
              </span>
              <span className="text-[10px] uppercase tracking-micro text-muted-foreground">
                © {year} · All rights reserved
              </span>
            </span>
          </Link>

          <div className="flex items-center justify-between gap-5 md:gap-7">
            <nav aria-label="Social" className="flex items-center gap-1.5">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors duration-200 hover:border-border hover:bg-foreground/[0.04] hover:text-foreground"
                >
                  {s.icon}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}

function TelegramIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  );
}

function XIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
