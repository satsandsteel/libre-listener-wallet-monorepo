import {
  LibreListenerWallet,
  SecureStorageProvider,
  WebSocketStreamProvider,
  WebSocketConnection,
} from "@libre/listener-wallet";

// 1. Browser websocket connection provider for LDK
class BrowserWebSocketStreamProvider implements WebSocketStreamProvider {
  async connect(address: string, port: number): Promise<WebSocketConnection> {
    // Bridge browser WebSocket to LND TCP port 9735 via websockify at 127.0.0.1:8081
    const wsUrl = "ws://127.0.0.1:8081";
    appendLog(`[SYSTEM] Connecting WebSocket bridge to ${wsUrl} (LND peer at ${address}:${port})...`, "system");
    
    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";

    const conn: WebSocketConnection = {
      send: (data: Uint8Array) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data);
        }
      },
      close: () => {
        socket.close();
      },
    };

    socket.onmessage = (event) => {
      conn.onmessage?.(new Uint8Array(event.data));
    };

    socket.onerror = (err) => {
      conn.onerror?.(new Error("WebSocket error"));
    };

    socket.onclose = () => {
      conn.onclose?.();
    };

    return new Promise((resolve, reject) => {
      socket.onopen = () => {
        appendLog(`[SYSTEM] WebSocket bridge connected to LSP peer!`, "system");
        resolve(conn);
      };
      socket.onerror = (err) => {
        appendLog(`[ERROR] WebSocket bridge failed to connect to ${wsUrl}`, "error");
        reject(new Error("WebSocket failed to connect"));
      };
    });
  }
}

// 2. Browser local storage implementation for LDK settings
const storage: SecureStorageProvider = {
  getItem: async (key: string) => localStorage.getItem(key),
  setItem: async (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: async (key: string) => localStorage.removeItem(key),
};

// 3. Logger helper to update UI terminal console
const terminalContent = document.getElementById("terminal-content") as HTMLDivElement;
const logFilter = document.getElementById("log-filter") as HTMLSelectElement;

function appendLog(msg: string, type: "info" | "warn" | "error" | "system" | "ldk-info" | "ldk-debug" | "ldk-trace") {
  const line = document.createElement("div");
  line.className = `log-line ${type}`;
  line.innerText = msg;
  terminalContent.appendChild(line);
  
  // Keep scrolling to the bottom
  terminalContent.parentElement!.scrollTop = terminalContent.parentElement!.scrollHeight;

  // Filter visibility based on current selection
  applyLogFilter();
}

function applyLogFilter() {
  const filter = logFilter.value;
  const lines = terminalContent.querySelectorAll(".log-line");
  lines.forEach((lineNode) => {
    const el = lineNode as HTMLDivElement;
    if (filter === "all") {
      el.style.display = "block";
    } else if (filter === "error" && el.classList.contains("error")) {
      el.style.display = "block";
    } else if (filter === "warn" && el.classList.contains("warn")) {
      el.style.display = "block";
    } else if (filter === "info" && (el.classList.contains("info") || el.classList.contains("system") || el.classList.contains("ldk-info"))) {
      el.style.display = "block";
    } else {
      el.style.display = "none";
    }
  });
}

// 4. Wallet Lifecycle State
let wallet: LibreListenerWallet | null = null;
let isNodeRunning = false;

// DOM Elements
const startNodeBtn = document.getElementById("start-node-btn") as HTMLButtonElement;
const stopNodeBtn = document.getElementById("stop-node-btn") as HTMLButtonElement;
const walletStatusBadge = document.getElementById("wallet-status-badge") as HTMLSpanElement;
const seedInput = document.getElementById("seed-input") as HTMLInputElement;
const toggleSeedBtn = document.getElementById("toggle-seed-btn") as HTMLButtonElement;
const esploraUrlInput = document.getElementById("esplora-url-input") as HTMLInputElement;
const nodeIdVal = document.getElementById("node-id-val") as HTMLSpanElement;
const peersCountVal = document.getElementById("peers-count") as HTMLSpanElement;

const lspConnStrInput = document.getElementById("lsp-conn-str") as HTMLInputElement;
const lspApiUrlInput = document.getElementById("lsp-api-url") as HTMLInputElement;
const connectLspBtn = document.getElementById("connect-lsp-btn") as HTMLButtonElement;

const requestJitBtn = document.getElementById("request-jit-btn") as HTMLButtonElement;
const jitAmountInput = document.getElementById("jit-amount") as HTMLInputElement;
const jitDescInput = document.getElementById("jit-desc") as HTMLInputElement;
const jitInvoiceContainer = document.getElementById("jit-invoice-container") as HTMLDivElement;
const jitInvoiceStr = document.getElementById("jit-invoice-str") as HTMLTextAreaElement;
const copyJitInvoiceBtn = document.getElementById("copy-jit-invoice-btn") as HTMLButtonElement;

const purchaseLsps1Btn = document.getElementById("purchase-lsps1-btn") as HTMLButtonElement;
const lsps1AmountInput = document.getElementById("lsps1-amount") as HTMLInputElement;
const lsps1InvoiceContainer = document.getElementById("lsps1-invoice-container") as HTMLDivElement;
const lsps1InvoiceStr = document.getElementById("lsps1-invoice-str") as HTMLTextAreaElement;
const copyLsps1InvoiceBtn = document.getElementById("copy-lsps1-invoice-btn") as HTMLButtonElement;

const clearLogsBtn = document.getElementById("clear-logs-btn") as HTMLButtonElement;

// Helper to extract hex node id from byte array
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 5. Setup Action Listeners
toggleSeedBtn.addEventListener("click", () => {
  if (seedInput.type === "password") {
    seedInput.type = "text";
    toggleSeedBtn.innerText = "Hide";
  } else {
    seedInput.type = "password";
    toggleSeedBtn.innerText = "Show";
  }
});

clearLogsBtn.addEventListener("click", () => {
  terminalContent.innerHTML = "";
  appendLog("[SYSTEM] Console cleared.", "system");
});

logFilter.addEventListener("change", applyLogFilter);

// 6. Start LDK Node
startNodeBtn.addEventListener("click", async () => {
  try {
    startNodeBtn.disabled = true;
    appendLog("[SYSTEM] Initializing LibreListenerWallet...", "system");
    appendLog("[SYSTEM] Fetching and compiling LDK WebAssembly...", "system");

    // Save custom seed to localStorage before start
    const seed = seedInput.value.trim();
    if (seed.length !== 64) {
      throw new Error("Seed must be a 32-byte hex string (64 characters)");
    }
    await storage.setItem("ldk_seed", seed);

    const esploraUrl = esploraUrlInput.value.trim();

    wallet = new LibreListenerWallet({
      config: {
        network: "regtest",
        esploraUrl,
      },
      storage,
      socketProvider: new BrowserWebSocketStreamProvider(),
      wasmUrl: "/liblightningjs.wasm",
      logger: {
        info: (msg: string, ...args: any[]) => {
          console.log(msg, ...args);
          if (msg.startsWith("[LDK]")) {
            if (msg.includes("[TRACE]")) appendLog(msg, "ldk-trace");
            else if (msg.includes("[DEBUG]")) appendLog(msg, "ldk-debug");
            else appendLog(msg, "ldk-info");
          } else {
            appendLog(msg, "info");
          }
        },
        warn: (msg: string, ...args: any[]) => {
          console.warn(msg, ...args);
          appendLog(msg, "warn");
        },
        error: (msg: string, ...args: any[]) => {
          console.error(msg, ...args);
          appendLog(msg, "error");
        },
      },
    });

    // Handle incoming LDK Events
    wallet.addEventListener((event: any) => {
      const name = event.constructor.name;
      appendLog(`[LDK EVENT] Event fired: ${name}`, "system");
      
      // Update peers list status
      if (wallet) {
        const peers = wallet.getConnectedPeers();
        peersCountVal.innerText = peers.length.toString();
      }
    });

    await wallet.start();
    isNodeRunning = true;
    appendLog("[SYSTEM] LDK Node running successfully!", "system");

    // Update UI Status
    walletStatusBadge.innerText = "Running";
    walletStatusBadge.className = "badge badge-status running";
    stopNodeBtn.disabled = false;
    connectLspBtn.disabled = false;
    requestJitBtn.disabled = false;
    purchaseLsps1Btn.disabled = false;

    // Display Node ID
    const mgr = wallet.getChannelManager();
    if (mgr) {
      const nodeId = bytesToHex(mgr.get_our_node_id());
      nodeIdVal.innerText = nodeId;
    }
  } catch (err: any) {
    appendLog(`[ERROR] Start failed: ${err.message}`, "error");
    startNodeBtn.disabled = false;
  }
});

// 7. Stop LDK Node
stopNodeBtn.addEventListener("click", async () => {
  if (!wallet || !isNodeRunning) return;
  try {
    stopNodeBtn.disabled = true;
    appendLog("[SYSTEM] Shutting down LDK Node...", "system");
    await wallet.stop();
    isNodeRunning = false;
    wallet = null;

    appendLog("[SYSTEM] LDK Node stopped.", "system");

    // Reset UI
    walletStatusBadge.innerText = "Stopped";
    walletStatusBadge.className = "badge badge-status stopped";
    startNodeBtn.disabled = false;
    connectLspBtn.disabled = true;
    requestJitBtn.disabled = true;
    purchaseLsps1Btn.disabled = true;
    nodeIdVal.innerText = "-";
    peersCountVal.innerText = "0";
    jitInvoiceContainer.classList.add("hidden");
    lsps1InvoiceContainer.classList.add("hidden");
  } catch (err: any) {
    appendLog(`[ERROR] Stop failed: ${err.message}`, "error");
    stopNodeBtn.disabled = false;
  }
});

// 8. Connect Peer
connectLspBtn.addEventListener("click", async () => {
  if (!wallet || !isNodeRunning) return;
  try {
    connectLspBtn.disabled = true;
    const connStr = lspConnStrInput.value.trim();
    if (!connStr.includes("@") || !connStr.includes(":")) {
      throw new Error("LSP connection string must be in pubkey@host:port format");
    }

    const [pubkey, addressPort] = connStr.split("@");
    const [host, portStr] = addressPort.split(":");
    const port = parseInt(portStr, 10);

    appendLog(`[SYSTEM] Connecting to peer ${pubkey}...`, "system");
    await wallet.connectPeer(pubkey, host, port);
    
    appendLog(`[SYSTEM] Peer connected!`, "system");
    
    // Update peer count
    if (wallet) {
      const peers = wallet.getConnectedPeers();
      peersCountVal.innerText = peers.length.toString();
    }
  } catch (err: any) {
    appendLog(`[ERROR] Peer connection failed: ${err.message}`, "error");
  } finally {
    connectLspBtn.disabled = false;
  }
});

// 9. Request LSPS2 JIT Invoice
requestJitBtn.addEventListener("click", async () => {
  if (!wallet || !isNodeRunning) return;
  try {
    requestJitBtn.disabled = true;
    jitInvoiceContainer.classList.add("hidden");

    const amountSats = parseInt(jitAmountInput.value, 10);
    const description = jitDescInput.value.trim();
    const lspConnStr = lspConnStrInput.value.trim();
    const [lspPubkey] = lspConnStr.split("@");

    const lsp = {
      name: "libre-lsp",
      pubkey: lspPubkey,
      connection_string: lspConnStr,
      api_url: lspApiUrlInput.value.trim(),
      protocols: ["lsps2" as const],
    };

    appendLog(`[LSPS2] Initiating JIT invoice request for ${amountSats} sats...`, "system");
    const invoice = await wallet.requestLSPS2Invoice({
      amountSats,
      description,
      lsp,
    });

    appendLog(`[LSPS2] Invoice received: ${invoice.substring(0, 30)}...`, "system");
    jitInvoiceStr.value = invoice;
    jitInvoiceContainer.classList.remove("hidden");
  } catch (err: any) {
    appendLog(`[ERROR] LSPS2 request failed: ${err.message}`, "error");
  } finally {
    requestJitBtn.disabled = false;
  }
});

copyJitInvoiceBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(jitInvoiceStr.value);
  appendLog("[SYSTEM] JIT Invoice copied to clipboard.", "system");
});

// 10. Purchase LSPS1 Capacity
purchaseLsps1Btn.addEventListener("click", async () => {
  if (!wallet || !isNodeRunning) return;
  try {
    purchaseLsps1Btn.disabled = true;
    lsps1InvoiceContainer.classList.add("hidden");

    const amountSats = parseInt(lsps1AmountInput.value, 10);
    const lspConnStr = lspConnStrInput.value.trim();
    const [lspPubkey] = lspConnStr.split("@");

    const lsp = {
      name: "libre-lsp",
      pubkey: lspPubkey,
      connection_string: lspConnStr,
      api_url: lspApiUrlInput.value.trim().replace("/lsps2", "/lsps1"), // Fallback LSPS1 api endpoint
      protocols: ["lsps1" as const],
    };

    appendLog(`[LSPS1] Purchasing ${amountSats} sats inbound capacity...`, "system");
    const invoice = await wallet.purchaseLSPS1Capacity({
      amountSats,
      lsp,
    });

    appendLog(`[LSPS1] Order placed! Pay invoice: ${invoice.substring(0, 30)}...`, "system");
    lsps1InvoiceStr.value = invoice;
    lsps1InvoiceContainer.classList.remove("hidden");
  } catch (err: any) {
    appendLog(`[ERROR] LSPS1 purchase failed: ${err.message}`, "error");
  } finally {
    purchaseLsps1Btn.disabled = false;
  }
});

copyLsps1InvoiceBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(lsps1InvoiceStr.value);
  appendLog("[SYSTEM] LSPS1 Invoice copied to clipboard.", "system");
});
