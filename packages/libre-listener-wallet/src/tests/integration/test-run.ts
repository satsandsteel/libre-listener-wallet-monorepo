import {
  LibreListenerWallet,
  SecureStorageProvider,
  WebSocketStreamProvider,
  WebSocketConnection,
} from "../../index";
import { bytesToHex, hexToBytes } from "../../storage-cache";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import { execSync, exec } from "child_process";
import {
  EventHandler,
  Event,
  Event_PaymentClaimable,
  Result_NoneReplayEventZ,
} from "lightningdevkit";

function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch (err: any) {
    console.error(`Error running command: ${cmd}`, err.stderr || err.message);
    throw err;
  }
}

function runCmdAsync(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        console.error(`Error running async command: ${cmd}`, stderr || err.message);
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function getLndChannelAlias(remoteNodeId: string): string {
  const channelListStr = runCmd("docker exec libre-lnd lncli --network=regtest listchannels");
  const channelList = JSON.parse(channelListStr);
  const chan = channelList.channels.find(
    (c: any) => c.remote_pubkey === remoteNodeId
  );
  if (!chan) {
    throw new Error(`No channel found to remote node ${remoteNodeId}`);
  }
  return chan.alias_scids[0] || chan.peer_scid_alias;
}

function loadWasmBinary(): Uint8Array {
  const p = path.resolve(__dirname, "../../../node_modules/lightningdevkit/liblightningjs.wasm");
  if (fs.existsSync(p)) {
    return fs.readFileSync(p);
  }
  const p2 = path.resolve(__dirname, "../../../../node_modules/lightningdevkit/liblightningjs.wasm");
  if (fs.existsSync(p2)) {
    return fs.readFileSync(p2);
  }
  throw new Error("Could not find liblightningjs.wasm");
}

class TCPStreamProvider implements WebSocketStreamProvider {
  async connect(address: string, port: number): Promise<WebSocketConnection> {
    console.log(`[TCPStreamProvider] Connecting to ${address}:${port}...`);
    const socket = net.connect(port, address);

    const conn: WebSocketConnection = {
      send: (data: Uint8Array) => {
        socket.write(data);
      },
      close: () => {
        socket.destroy();
      },
    };

    socket.on("data", (data) => {
      conn.onmessage?.(new Uint8Array(data));
    });

    socket.on("error", (err) => {
      conn.onerror?.(err);
    });

    socket.on("close", () => {
      conn.onclose?.();
    });

    return new Promise((resolve, reject) => {
      socket.once("connect", () => {
        console.log(`[TCPStreamProvider] Socket connected!`);
        resolve(conn);
      });
      socket.once("error", (err) => {
        reject(err);
      });
    });
  }
}

const lspApiUrl = "http://127.0.0.1:9099/lsps2";

let lspPubkey = "02bdafbf7a60765a9ab4673350c1b5954449e290f498d1ff3a77c58eb7cebfbf24";
let mockJitScid = "1234567890123456";

const mswServer = setupServer(
  http.get("http://127.0.0.1:3002/blocks/tip/height", async () => {
    const height = runCmd("docker exec libre-bitcoind bitcoin-cli -regtest -rpcuser=libre -rpcpassword=listener getblockcount");
    return HttpResponse.text(height);
  }),
  http.get("http://127.0.0.1:3002/blocks/tip/hash", async () => {
    const hash = runCmd("docker exec libre-bitcoind bitcoin-cli -regtest -rpcuser=libre -rpcpassword=listener getbestblockhash");
    return HttpResponse.text(hash);
  }),
  http.get("http://127.0.0.1:3002/block-height/:height", async ({ params }) => {
    const hash = runCmd(`docker exec libre-bitcoind bitcoin-cli -regtest -rpcuser=libre -rpcpassword=listener getblockhash ${params.height}`);
    return HttpResponse.text(hash);
  }),
  http.get("http://127.0.0.1:3002/block/:hash/header", async ({ params }) => {
    const header = runCmd(`docker exec libre-bitcoind bitcoin-cli -regtest -rpcuser=libre -rpcpassword=listener getblockheader ${params.hash} false`);
    return HttpResponse.text(header);
  }),
  http.get("http://127.0.0.1:3002/fee-estimates", () => {
    return HttpResponse.json({ "1": 15.0, "6": 8.0, "144": 2.0 });
  }),

  http.post(lspApiUrl, async ({ request }) => {
    const body = (await request.clone().json()) as any;
    const { id, method, params } = body;
    console.log(`[MSW LSP API MOCK] Received request method: ${method}`);

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
  })
);

async function main() {
  console.log("Starting MSW server...");
  mswServer.listen({ onUnhandledRequest: "bypass" });

  try {
    const infoStr = runCmd("docker exec libre-lnd lncli --network=regtest getinfo");
    const info = JSON.parse(infoStr);
    if (info.identity_pubkey) {
      lspPubkey = info.identity_pubkey;
      console.log(`[TEST] Dynamically detected LSP Node ID: ${lspPubkey}`);
    }
  } catch (err) {
    console.warn("[TEST] Could not fetch LSP pubkey dynamically, using fallback", err);
  }

  const lsp = {
    name: "libre-lnd",
    pubkey: lspPubkey,
    connection_string: `${lspPubkey}@127.0.0.1:9735`,
    api_url: lspApiUrl,
    protocols: ["lsps2" as const],
  };

  const db = new Map<string, string>();
  const storage: SecureStorageProvider = {
    getItem: async (k) => db.get(k) || null,
    setItem: async (k, v) => {
      db.set(k, v);
    },
    removeItem: async (k) => {
      db.delete(k);
    },
  };

  console.log("Initializing LibreListenerWallet...");
  const wallet = new LibreListenerWallet({
    config: {
      network: "regtest",
      esploraUrl: "http://127.0.0.1:3002",
    },
    storage,
    socketProvider: new TCPStreamProvider(),
    wasmBinary: loadWasmBinary(),
    logger: {
      info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
      warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    },
  });

  await wallet.start();
  const ourNodeId = bytesToHex(wallet.getChannelManager()!.get_our_node_id());
  console.log(`[TEST] Our node ID: ${ourNodeId}`);

  // Connect peer
  await wallet.connectPeer(lsp.pubkey, "127.0.0.1", 9735);
  console.log("[TEST] Connected to LND peer, sleeping 2s for handshake...");
  await new Promise((r) => setTimeout(r, 2000));

  // Verify peer list on LND
  const peersStr = runCmd("docker exec libre-lnd lncli --network=regtest listpeers");
  console.log(`[TEST] LND Peers: ${peersStr}`);

  let channelReady = false;
  let paymentClaimed = false;

  const testListener = (event: Event) => {
    const name = event.constructor.name;
    console.log(`[TEST EVENT LISTENER] Received event: ${name}`);
    if (name === "Event_ChannelReady") {
      console.log("[TEST EVENT LISTENER] ChannelReady detected!");
      channelReady = true;
    } else if (event instanceof Event_PaymentClaimable) {
      console.log("[TEST EVENT LISTENER] PaymentClaimable detected!");
      paymentClaimed = true;
    }
  };
  wallet.addEventListener(testListener);

  // Manually trigger LND to open a zero-conf channel to LDK
  console.log("[TEST] Instructing LND to open zero-conf channel to LDK (async)...");
  const openPromise = runCmdAsync(
    `docker exec libre-lnd lncli --network=regtest openchannel --node_key ${ourNodeId} --local_amt 1000000 --zero_conf --private --channel_type anchors`
  ).then((res) => {
    console.log(`[TEST] openchannel completed: ${res}`);
  }).catch((err) => {
    console.error(`[TEST] openchannel failed: ${err.message}`);
  });

  // Wait for the channel to become ready
  console.log("[TEST] Waiting for ChannelReady...");
  for (let i = 0; i < 30; i++) {
    if (channelReady) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Poll LND listchannels to see if it is active and retrieve the actual alias
  console.log("[TEST] Polling LND listchannels...");
  let actualAlias = "";
  for (let i = 0; i < 5; i++) {
    const channelListStr = runCmd("docker exec libre-lnd lncli --network=regtest listchannels");
    const channelList = JSON.parse(channelListStr);
    const activeChan = channelList.channels.find(
      (c: any) => c.remote_pubkey === ourNodeId
    );
    if (activeChan) {
      console.log(`[TEST LND Channel] active: ${activeChan.active}, chan_id: ${activeChan.chan_id}, local_balance: ${activeChan.local_balance}`);
      actualAlias = activeChan.alias_scids[0] || activeChan.peer_scid_alias;
    } else {
      console.log("[TEST LND Channel] channel not found in listchannels!");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!actualAlias) {
    throw new Error("Could not find actual alias channel ID");
  }
  mockJitScid = actualAlias;
  console.log(`[TEST] Updated mockJitScid to actual alias: ${mockJitScid}`);


  // Request LSPS2 Invoice
  console.log("[TEST] Requesting LSPS2 invoice...");
  const invoice = await wallet.requestLSPS2Invoice({
    amountSats: 20000,
    description: "Integration test JIT",
    lsp,
  });
  console.log(`[TEST] Generated JIT invoice: ${invoice}`);

  // Instruct LND to pay the JIT invoice
  console.log("[TEST] Instructing LND to pay the JIT invoice (async)...");
  const payPromise = runCmdAsync(
    `docker exec libre-lnd lncli --network=regtest payinvoice --force --pay_req ${invoice}`
  ).then((res) => {
    console.log(`[TEST] payinvoice completed: ${res}`);
  }).catch((err) => {
    console.error(`[TEST] payinvoice failed: ${err.message}`);
  });

  // Wait for PaymentClaimable
  console.log("[TEST] Waiting for PaymentClaimable...");
  for (let i = 0; i < 30; i++) {
    if (paymentClaimed) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  // Mine blocks to confirm channel and resolve HTLCs
  console.log("[TEST] Mining 1 block on regtest...");
  runCmd(`docker exec libre-bitcoind bitcoin-cli -regtest -rpcuser=libre -rpcpassword=listener generatetoaddress 1 bcrt1qwqp2ru0sx58gpv4fmleuf02wcmu8rs5w93ld6u`);

  // Give time to settle
  console.log("[TEST] Waiting 5s to settle...");
  await new Promise((r) => setTimeout(r, 5000));

  await openPromise;
  await payPromise;

  wallet.removeEventListener(testListener);
  console.log("Stopping wallet...");
  await wallet.stop();
  console.log("Stopping MSW server...");
  mswServer.close();

  console.log("Success checks:");
  console.log("channelReady:", channelReady);
  console.log("paymentClaimed:", paymentClaimed);
}

main().catch((err) => {
  console.error("Fatal Error in main:", err);
  process.exit(1);
});
