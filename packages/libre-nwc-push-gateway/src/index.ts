import { NWCRequest, NWCResponse } from "@libre/shared";

export interface GatewayConfig {
  host: string;
  port: number;
  relayUrl: string;
}

export class LibreNWCPushGateway {
  private config: GatewayConfig;
  private isRunning: boolean = false;

  constructor(config: GatewayConfig) {
    // Restrict to localhost by default for security testing
    this.config = {
      host: config.host || "127.0.0.1",
      port: config.port,
      relayUrl: config.relayUrl,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    console.log(`Starting Libre NWC Push Gateway on ${this.config.host}:${this.config.port}`);
    console.log(`Connecting to relay: ${this.config.relayUrl}`);
    // Listener implementation will go here in Milestone 6
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    console.log("Stopping Libre NWC Push Gateway...");
    this.isRunning = false;
  }

  async processRequest(request: NWCRequest): Promise<NWCResponse> {
    // Process request placeholder
    return {
      result_type: request.method,
      result: {
        success: true,
      },
    };
  }

  status(): "Stopped" | "Running" {
    return this.isRunning ? "Running" : "Stopped";
  }
}
