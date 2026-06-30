"use client";

import * as React from "react";
import { apiClient } from "@/lib/api-client";

/**
 * Tracks the server-side session (the lowercased bech32 address proven via
 * /api/auth/verify). A connected Keplr wallet is NOT yet a verified session —
 * the session is populated after the user signs and the cookie is set.
 *
 * If the user switches accounts in Keplr we drop the session (the
 * `keplr_keystorechange` event) so we don't show alerts for a wallet the user
 * no longer controls.
 */
interface WalletSessionContextValue {
  address: string | null;
  setAddress: (addr: string | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const WalletSessionContext = React.createContext<WalletSessionContextValue | null>(null);

export function WalletSessionProvider({
  initialAddress,
  children,
}: {
  initialAddress: string | null;
  children: React.ReactNode;
}): JSX.Element {
  const [address, setAddress] = React.useState<string | null>(
    initialAddress ? initialAddress.toLowerCase() : null,
  );

  const refresh = React.useCallback(async () => {
    try {
      const res = await apiClient.getSession();
      setAddress(res.address ? res.address.toLowerCase() : null);
    } catch {
      setAddress(null);
    }
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await apiClient.logout();
    } catch {
      /* ignore */
    }
    setAddress(null);
  }, []);

  // Keplr fires `keplr_keystorechange` when the user switches accounts. Drop
  // the server session so a stale address can't linger after the switch.
  React.useEffect(() => {
    if (!address) return;
    function onKeystoreChange(): void {
      void logout();
    }
    window.addEventListener("keplr_keystorechange", onKeystoreChange);
    return () =>
      window.removeEventListener("keplr_keystorechange", onKeystoreChange);
  }, [address, logout]);

  const value = React.useMemo<WalletSessionContextValue>(
    () => ({ address, setAddress, refresh, logout }),
    [address, refresh, logout],
  );

  return (
    <WalletSessionContext.Provider value={value}>
      {children}
    </WalletSessionContext.Provider>
  );
}

export function useWalletSession(): WalletSessionContextValue {
  const ctx = React.useContext(WalletSessionContext);
  if (!ctx) {
    throw new Error("useWalletSession must be used inside WalletSessionProvider");
  }
  return ctx;
}
