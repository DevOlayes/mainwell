import type { NetworkId } from "./types";

export interface NetworkDefinition {
  id: NetworkId;
  displayName: string;
  family: "evm" | "tron" | "solana" | "bitcoin";
  integrationStatus: "catalog-only";
  notes: string;
}

/** Product targets only; no live RPC or signing integration is implied. */
export const NETWORKS: readonly NetworkDefinition[] = [
  { id: "ethereum", displayName: "Ethereum", family: "evm", integrationStatus: "catalog-only", notes: "EVM read-only adapter required." },
  { id: "polygon", displayName: "Polygon", family: "evm", integrationStatus: "catalog-only", notes: "EVM read-only adapter required." },
  { id: "bsc", displayName: "BNB Smart Chain", family: "evm", integrationStatus: "catalog-only", notes: "EVM read-only adapter required." },
  { id: "avalanche", displayName: "Avalanche C-Chain", family: "evm", integrationStatus: "catalog-only", notes: "EVM read-only adapter required." },
  { id: "arbitrum", displayName: "Arbitrum", family: "evm", integrationStatus: "catalog-only", notes: "EVM read-only adapter required." },
  { id: "optimism", displayName: "Optimism", family: "evm", integrationStatus: "catalog-only", notes: "EVM read-only adapter required." },
  { id: "base", displayName: "Base", family: "evm", integrationStatus: "catalog-only", notes: "EVM read-only adapter required." },
  { id: "tron", displayName: "TRON", family: "tron", integrationStatus: "catalog-only", notes: "Energy/Bandwidth and permission adapter required." },
  { id: "solana", displayName: "Solana", family: "solana", integrationStatus: "catalog-only", notes: "Account and token-program read adapter required." },
  { id: "bitcoin", displayName: "Bitcoin", family: "bitcoin", integrationStatus: "catalog-only", notes: "UTXO discovery and fee estimation adapter required." }
];

export function isSupportedNetwork(value: string): value is NetworkId {
  return NETWORKS.some((network) => network.id === value);
}
