export interface RpcCall {
  method: string;
  params: unknown[];
}

export interface QuorumOpts {
  needed: number;
  sample: number;
  customRpc?: { url: string; role: "primary" | "fallback" };
}
