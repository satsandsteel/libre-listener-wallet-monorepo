import { WalletConfig } from "@libre/shared";

export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export interface SecureStorageProvider {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface WebSocketConnection {
  send(data: Uint8Array): void;
  close(): void;
  onmessage?: (data: Uint8Array) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}

export interface WebSocketStreamProvider {
  connect(address: string, port: number): Promise<WebSocketConnection>;
}

export class LibreListenerWallet {
  private config: WalletConfig;
  private logger?: Logger;
  private storage: SecureStorageProvider;
  private socketProvider: WebSocketStreamProvider;
  private isRunning: boolean = false;

  constructor(options: {
    config: WalletConfig;
    storage: SecureStorageProvider;
    socketProvider: WebSocketStreamProvider;
    logger?: Logger;
  }) {
    this.config = options.config;
    this.storage = options.storage;
    this.socketProvider = options.socketProvider;
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger?.warn("Wallet is already running");
      return;
    }
    this.logger?.info(`Starting LDK Node on network: ${this.config.network}`);
    // Initialization logic will go here in Milestone 2
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger?.warn("Wallet is not running");
      return;
    }
    this.logger?.info("Stopping LDK Node...");
    // Shutdown logic will go here in Milestone 2
    this.isRunning = false;
  }

  status(): "Stopped" | "Running" {
    return this.isRunning ? "Running" : "Stopped";
  }
}
