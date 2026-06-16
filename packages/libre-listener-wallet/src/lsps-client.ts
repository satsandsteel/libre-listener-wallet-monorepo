import { JsonRpcRequest, JsonRpcResponse } from "@libre/shared";
import { Logger } from "./index";

export class LspsClient {
  private apiUrl: string;
  private logger?: Logger;

  constructor(apiUrl: string, logger?: Logger) {
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.logger = logger;
  }

  async request<TRequest = any, TResponse = any>(
    method: string,
    params: TRequest
  ): Promise<TResponse> {
    const id = Math.floor(Math.random() * 1000000);
    const body: JsonRpcRequest<TRequest> = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    this.logger?.info(`[LSPS Client] Requesting ${method} to ${this.apiUrl}`, params);

    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger?.error(`[LSPS Client] HTTP Error: ${res.status} ${res.statusText} - ${text}`);
      throw new Error(`LSPS API HTTP error: ${res.status} ${res.statusText}`);
    }

    const responseData = (await res.json()) as JsonRpcResponse<TResponse>;

    if (responseData.error) {
      this.logger?.error(`[LSPS Client] Method ${method} returned JSON-RPC error: ${responseData.error.message} (code: ${responseData.error.code})`);
      throw new Error(`LSPS JSON-RPC error: ${responseData.error.message} (code: ${responseData.error.code})`);
    }

    if (responseData.result === undefined) {
      throw new Error(`LSPS JSON-RPC error: Response missing result for method ${method}`);
    }

    return responseData.result;
  }
}
