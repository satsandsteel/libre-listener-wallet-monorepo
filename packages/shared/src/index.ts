export interface WalletConfig {
  network: "mainnet" | "testnet" | "regtest" | "signet";
  esploraUrl: string;
  rapidGossipSyncUrl?: string;
}

export interface NWCRequest {
  method: "get_info" | "get_balance" | "make_invoice" | "pay_invoice" | "pay_keysend";
  params: Record<string, any>;
}

export interface NWCResponse {
  result_type: string;
  error?: {
    code: string;
    message: string;
  };
  result?: Record<string, any>;
}
