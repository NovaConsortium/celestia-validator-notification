export type EventType =
  | "skip"
  | "offline"
  | "recovered"
  | "delegate"
  | "undelegate"
  | "commission_changed";

export type Severity = "info" | "warning" | "critical";

export type Network = "mainnet" | "testnet";

export interface ValidatorEvent {
  id?: string;
  validatorId: bigint;
  network: Network;
  type: EventType;
  severity: Severity;
  payload: Record<string, unknown>;
  blockNumber?: bigint;
  occurredAt: Date;
  dedupKey?: string;
}
