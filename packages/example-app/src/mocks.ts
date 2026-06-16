import { setupWorker } from "msw/browser";
import { http, HttpResponse } from "msw";

const lspApiUrlLSPS2 = "http://127.0.0.1:9099/lsps2";
const lspApiUrlLSPS1 = "http://127.0.0.1:9099/lsps1";

const mockJitScid = "1234567890123456";
const lspPubkey = "02bdafbf7a60765a9ab4673350c1b5954449e290f498d1ff3a77c58eb7cebfbf24";

export const handlers = [
  // LSPS2 JIT API Mocks
  http.post(lspApiUrlLSPS2, async ({ request }) => {
    const body = (await request.json()) as any;
    const { id, method, params } = body;

    console.log(`[MSW Mock] Intercepted LSPS2 call: method=${method}`, body);

    if (method === "lsps2.get_versions") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id,
        result: { versions: [1] },
      });
    }

    if (method === "lsps2.get_info") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          opening_fee_params_menu: [
            {
              opening_fee_params_id: "test_fee_params_id",
              min_fee_msat: "250000",
              proportional_fee_ppm: 1000,
              min_lifetime_blocks: 2016,
              cltv_expiry_delta: 144,
              valid_until: "2026-06-30T00:00:00Z",
            },
          ],
          min_payment_size_msat: "1000",
          max_payment_size_msat: "100000000",
        },
      });
    }

    if (method === "lsps2.buy") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          jit_channel_scid: mockJitScid,
          lsp_node_id: lspPubkey,
          client_node_id: params.client_node_id,
          payment_size_msat: params.opening_fee_params.min_fee_msat,
          cltv_expiry_delta: 144,
        },
      });
    }

    return HttpResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  }),

  // LSPS1 API Mocks
  http.post(lspApiUrlLSPS1, async ({ request }) => {
    const body = (await request.json()) as any;
    const { id, method } = body;

    console.log(`[MSW Mock] Intercepted LSPS1 call: method=${method}`, body);

    if (method === "lsps1.get_info") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          min_channel_balance_sat: "20000",
          max_channel_balance_sat: "1000000",
          min_initial_client_balance_sat: "0",
          max_initial_client_balance_sat: "0",
          min_channel_expiry_blocks: 2016,
          max_channel_expiry_blocks: 4032,
        },
      });
    }

    if (method === "lsps1.create_order") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          order_id: "test_order_id_123",
          lsp_balance_sat: body.params.lsp_balance_sat,
          client_balance_sat: "0",
          payment_value_msat: "500000",
          payment_addr: "00112233445566778899aabbccddeeff",
          invoice: "lnbc500n1pvjlxyz...",
        },
      });
    }

    return HttpResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    });
  }),
];

export const worker = setupWorker(...handlers);
