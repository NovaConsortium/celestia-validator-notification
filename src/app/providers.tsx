"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { WalletSessionProvider } from "@/components/wallet/wallet-session-context";

interface ProvidersProps {
  children: React.ReactNode;
  initialWalletAddress: string | null;
}

export function Providers({
  children,
  initialWalletAddress,
}: ProvidersProps): JSX.Element {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <WalletSessionProvider initialAddress={initialWalletAddress}>
        {children}
      </WalletSessionProvider>
    </ThemeProvider>
  );
}
