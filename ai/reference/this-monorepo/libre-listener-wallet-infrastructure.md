# Technical Specification: Libre Listener Wallet SDK Infrastructure Requirements

Although the client-side wallet is "non-custodial" and runs entirely inside the user's browser or mobile app, it is a "light client" that still requires external infrastructure services to sync the blockchain, connect to the Lightning network, and acquire channels.

This document details the infrastructure dependencies, dividing them into **what you must host/provide** vs. **what you can outsource** to public utility services.

---

```
                       +---------------------------------------+
                       |       Client Browser / Mobile App     |
                       |       (LDK Node running in SDK)       |
                       +---------------------------------------+
                                           |
      +------------------+-----------------+---------------+-------------------+-------------------+
      | (HTTPS)          | (WebSockets)    | (HTTPS)       | (HTTPS)           | (HTTPS)           | (HTTPS)
      v                  v                 v               v                   v                   v
+---------------+  +---------------+ +-----------+  +---------------+  +---------------+  +---------------+
|  V4V Registry |  | TCP/WS Proxy  | |    LSP    |  |  Esplora API  |  |    LDK RGS    |  | Libre NWC Gate|
|  (.well-known)|  |   (Bridge)    | | (LSPS1/2) |  | (Chain Sync)  |  | (Gossip Sync) |  | (NIP-47 Wake) |
+---------------+  +---------------+ +-----------+  +---------------+  +---------------+  +---------------+
  [Must Host]        [Optional]       [Outsource]      [Outsourceable]    [Outsourceable]   [Shared/Vetted]
```

---

## 1. Core Infrastructure You MUST Host/Provide

### A. The Vetted LSP Registry (`.well-known`)
* **What it is:** A static JSON file containing the whitelisted LSPs.
* **Role:** The client wallet fetches this file to discover which LSPs it can query for JIT (LSPS2) channels and fee quotes.
* **How to Host:** 
  * In Next.js, place a `lightning-providers.json` file inside your `public/.well-known/` directory.
  * Serve it behind a Content Delivery Network (CDN) like Cloudflare to handle scale and ensure high availability.

### B. TCP-to-WebSocket Proxy (Web Bridge)
* **What it is:** A proxy server (e.g., `websockify` or a custom proxy utility).
* **Role:** Web browsers cannot establish raw TCP connections. Lightning nodes communicate over TCP. The browser client must establish a WebSocket connection to a bridge, which then relays raw TCP packets to the LSP node.
* **How to Host:**
  * You can run a small Docker container running `websockify` on your server.
  * **Note:** You only need to run this if your chosen whitelisted LSPs do not natively expose a WebSocket port. Some modern LSPs provide WebSocket ports directly.

### C. Decoupled Libre NWC Push Gateway (For Offline PWA Support)
* **What it is:** A stateless microservice (`libre-nwc-push-gateway`) running a Nostr subscriber and a Web Push notification sender.

* **Role:** When a client app (like Podverse) attempts to pay the wallet while the PWA is closed, the Gateway detects the encrypted NIP-47 Nostr event and sends a browser Push Notification to wake up the PWA Service Worker.
* **Database Isolation:** To maintain strict plug-and-play architecture, the Gateway runs its own isolated database (e.g., SQLite or a standalone Postgres container). It **never** integrates with or touches the host application's core product database.
* **Integration Choices:**
  1. **Hosted Public Utility:** Host apps can point the SDK client to a public gateway instance (e.g., `push.v4vmusic.com`). The host app writes **zero** backend code and runs **zero** databases.
  2. **Self-Hosted Instance:** Developers can run a standalone Docker container of the gateway (connected to SQLite/Redis) to separate notification routing from their main stack.
* **Zero-Custody Guarantee:** The gateway cannot read payment data or authorize transactions because the Nostr events are end-to-end encrypted with keys held only on the user's client device.

---

## 2. Infrastructure You Can Outsource (or Self-Host)

You do not need to build or run these yourself, but you must configure your SDK to point to active providers.

### A. Esplora API (Blockchain Data Sync)
* **What it is:** An HTTP REST API wrapper for Bitcoin Core.
* **Role:** The client LDK node queries Esplora to download block headers, track transaction status, and register filters for on-chain scripts (to ensure channel safety).
* **Outsourced Options (Free/Public):**
  * `https://blockstream.info/api/` (Mainnet)
  * `https://mempool.space/api/` (Mainnet)
  * `https://mutinynet.com/api/` (Mutinynet Signet)
* **Self-Hosted Option:** You can run `bitcoind` + `electrs` / `Esplora` in your own cluster for absolute privacy and guaranteed uptime (recommended for high-volume production).

### B. Rapid Gossip Sync (RGS) Server
* **What it is:** A server that aggregates Lightning network gossip (channels, nodes, features) and serves a highly compressed snapshot to light clients.
* **Role:** The client LDK node queries the RGS server when the user wants to buy capacity via Tier 3 (Liquidity Ads) or route payments. This replaces slow raw P2P gossip sync.
* **Outsourced Option:** The LDK team provides a free public RGS server:
  * `https://rapidsync.lightningdevkit.org/`
* **Self-Hosted Option:** You can run the LDK `rapid-gossip-sync-server` binary, which reads gossip data from your own routing node and serves it.

### C. Lightning Service Provider (LSP) Nodes
* **What it is:** The actual Lightning nodes that hold BTC liquidity, intercept incoming payments, and open channels.
* **Role:** Acts as the routing hub for your users.
* **Outsourced Option:** Partner with commercial providers (Breez, Blocktank, Olympus, Voltage) and pay them their standard fee rates.
* **Self-Hosted Option:** You can build and run your own LSP node (using LND or Core Lightning) equipped with LSPS1/LSPS2 plugins. You would fund it with your own capital (UTXOs) to provide liquidity to your users and collect the setup/routing fees.

---

## 3. Infrastructure Tradeoffs

| Service | Self-Hosted (Sovereign) | Outsourced (Third-Party) |
| :--- | :--- | :--- |
| **LSP Liquidity** | 🔴 **High Capital Requirement:** You must lock up several BTC of your own capital to act as the channel funding source. | 🟢 **Zero Capital:** Third-party LSPs use their own capital to fund your users' channels. |
| **Esplora API** | 🟢 **100% Privacy:** Your users' wallet addresses are never leaked to third parties. | 🔴 **Metadata Leakage:** External services see your users' queries for transaction data. |
| **TCP/WS Bridge** | 🟡 **Maintenance Overhead:** Running and scaling proxy servers for web-socket connections. | 🟢 **Zero Overhead:** Select LSPs that support WebSockets natively. |
| **Libre NWC Push Gateway**| 🟡 **Private Instance:** Host app runs a standalone container with SQLite/Postgres. Zero impact on core app DB. | 🟢 **Public Utility (Shared):** Host app uses `push.v4vmusic.com` (zero backend/DB overhead, remains non-custodial and private). |

