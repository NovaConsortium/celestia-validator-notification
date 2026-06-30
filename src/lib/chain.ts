/**
 * Celestia chain/network configuration.
 *
 * We keep the existing `Network = "mainnet" | "testnet"` vocabulary to avoid
 * churning that type across the app. Here "testnet" maps to Celestia's Mocha
 * testnet.
 *
 * Data sources:
 * - Celenium HTTP API: validator list/metadata/uptime.
 * - Celenium WS: per-block trigger (new height + proposer; no signatures).
 * - CometBFT RPC `/commit`: the per-height signer set (block_id_flag === 2).
 *   This is the canonical "did validator X sign height H?" source.
 */
import type { Network } from "@/types/events";

export interface ChainConfig {
  /** Celenium REST base, e.g. https://api-mainnet.celenium.io */
  celeniumBase: string;
  /** Celenium websocket URL */
  celeniumWs: string;
  /** CometBFT RPC base for /commit (signer set per height) */
  cometRpc: string;
  /** Public explorer base for links */
  explorer: string;
  /** Cosmos chain-id used by Keplr (enable / getKey / signArbitrary). */
  cosmosChainId: string;
}

/**
 * Read an env var, falling back to `dflt` when it's unset OR empty/whitespace.
 * `process.env.X ?? dflt` is wrong here: `.env.example` ships these keys with
 * blank values, and once copied to `.env` an empty string would otherwise win
 * over the default and produce broken (relative) URLs.
 */
function envOr(name: string, dflt: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : dflt;
}

export const CHAINS: Record<Network, ChainConfig> = {
  mainnet: {
    celeniumBase: envOr("CELENIUM_BASE_MAINNET", "https://api-mainnet.celenium.io"),
    celeniumWs: envOr("CELENIUM_WS_MAINNET", "wss://api.celenium.io/v1/ws"),
    cometRpc: envOr("CELESTIA_RPC_MAINNET", "https://celestia-rpc.publicnode.com"),
    explorer: envOr("CELENIUM_EXPLORER_MAINNET", "https://celenium.io"),
    cosmosChainId: envOr("CELESTIA_CHAIN_ID_MAINNET", "celestia"),
  },
  testnet: {
    celeniumBase: envOr("CELENIUM_BASE_MOCHA", "https://api-mocha.celenium.io"),
    celeniumWs: envOr("CELENIUM_WS_MOCHA", "wss://api-mocha.celenium.io/v1/ws"),
    cometRpc: envOr("CELESTIA_RPC_MOCHA", "https://celestia-mocha-rpc.publicnode.com"),
    explorer: envOr("CELENIUM_EXPLORER_MOCHA", "https://mocha.celenium.io"),
    cosmosChainId: envOr("CELESTIA_CHAIN_ID_MOCHA", "mocha-4"),
  },
};

export function chainFor(network: Network): ChainConfig {
  return CHAINS[network];
}

/** Optional Celenium API key (higher rate limits). */
export function celeniumApiKey(): string | undefined {
  return process.env.CELENIUM_API_KEY || undefined;
}

/** Validator detail page on the explorer (Celenium uses numeric id). */
export function validatorExplorerUrl(id: bigint | string, network: Network): string {
  return `${chainFor(network).explorer}/validator/${id.toString()}`;
}
