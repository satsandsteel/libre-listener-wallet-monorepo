# Technical Specification: Libre Listener Wallet Architecture (v5.0)

## 1. Overview & Architecture Goals

The objective of this architecture is to provide a zero-infrastructure, non-custodial Bitcoin Lightning Network implementation tailored for the `v4vmusic.com` ecosystem. The design explicitly targets the non-technical end-user, eliminating the friction of home-server maintenance, terminal configurations, and manual channel management.

The architecture isolates **Sats and Steel LLC** entirely within the **Software Safe Harbor**, ensuring the platform never takes custody of user funds, routes payments, or hosts commercial financial infrastructure.

### The Target Deployment Models

* **Target A (Desktop & PWA Web):** A static, web-native **LDK WebAssembly (WASM)** client running inside the browser/PWA sandbox, utilizing IndexedDB for secure local state storage. For offline background execution (e.g. Nostr Wallet Connect when the app is closed), it relies on a decoupled, stateless **Libre NWC Push Gateway** that wakes up the browser's **Service Worker** via standard **Web Push Notifications**.
* **Target B (Native Mobile Wrapper):** A compiled mobile application wrapper (React Native/Flutter) embedding native **LDK C/Rust bindings** to manage OS-level background execution, push notification wake-ups, and persistent file systems.

---

## 2. Multi-Tier Protocol-Native Liquidity Engine

To achieve seamless, automated onboarding for a user with a `0 sats` balance without encountering the regulatory liabilities of a Money Services Business (MSB), the local LDK node client utilizes an advanced **Multi-Tier Protocol-Native Liquidity Engine**.

Because a brand-new user owns exactly `0 sats` and zero on-chain UTXOs, they cannot physically contribute capital or sign transaction inputs to buy a standard peer-to-peer liquidity lease on day one. To bypass this onboarding paradox, the engine enforces strict separation between **Bootstrap Onboarding** and **Sovereign Maintenance** protocols.

```
                  +---------------------------------------+
                  |       Local LDK Client Wallet         |
                  |     (In-Browser WASM or Mobile)       |
                  +---------------------------------------+
                                      |
         +----------------------------+----------------------------+
         |                            |                            |
         v                            v                            v
+------------------+        +------------------+        +------------------+
|   Tier 1: LSPS2  |        |  Tier 2: LSPS1   |        | Tier 3: Native   |
|  JIT Interceptor |        |   Open Market    |        |  Liquidity Ads   |
+------------------+        +------------------+        +------------------+
| - First Deposit  |        | - Pre-Planned Cap|        | - Balanced Node  |
| - HTLC Intercept |        | - Dynamic Query  |        | - On-Demand RGS  |
| - LSP-Funded     |        | - HTTPS Registry |        | - P2P Gossip Net |
| - 0-Conf Channel |        | - Quote Bidding  |        | - Dual-funded L1 |
+------------------+        +------------------+        +------------------+
```

### Discovery & Whitelisting Middleware
To preserve user security, the wallet client discovers compliant LSPs via a dynamically hosted registry file (e.g., `https://v4vmusic.com/.well-known/lightning-providers.json`). This registry is manually curated and vetted by the application developers to ensure only high-reputation, solvent LSPs are presented to the client, preventing double-spend exploits on 0-conf channels.

### Tier 1: LSPS2 Just-In-Time Channel Interceptor (Bootstrap Onboarding)

When a user has `0 active channels`, standard peer-to-peer gossip routing is structurally impossible. The wallet forces all incoming initial deposits through the **LSPS2 (Just-In-Time Channel)** handshake protocol via a selected LSP from the registry.

* **The Interception Handshake:** When an external payment provider (e.g., Strike, Cash App) sends the user's very first deposit, the routing peer (LSP) captures the incoming payment packet using an **HTLC Interceptor**.
* **LSP-Funded Capital Allocation:** While holding the payment in transit, the routing peer allocates 100% of the required on-chain UTXO inputs from *its own* pool to broadcast a channel open to the user's local LDK instance. The user's client accepts and signs the channel commitment transaction, contributing zero local UTXO inputs.
* **0-Conf Activation:** Utilizing **Zero-Confirmation (Zero-Conf)** trust flags, the channel becomes instantly functional for the user before the funding transaction is mined into a Bitcoin block.
* **Atomic Fee Deduction:** The peer node deducts the upfront administrative premium and the Layer 1 mining weight reimbursement directly out of the incoming transaction payload, then pushes the remaining liquid balance cleanly across the channel to the user's local custody.

### Tier 2: Standardized LSPS1 Open Market (Pre-Planned Inbound Capacity)

Once an initial channel is active and funded, the client wallet shifts its discovery logic to the open **LSPS1 API standard** to scale its routing infrastructure cleanly.

* **Execution:** Instead of making requests to a hardcoded corporate endpoint, the local node queries the endpoints listed in the `.well-known` registry. The wallet programmatically compares real-time fee bids, speed characteristics, and channel durations, handling the handshake entirely transparently to the user.

### Tier 3: Native Protocol Liquidity Ads (Sovereign Gossip Rebalancing)

For ongoing wallet maintenance, subsequent channel expansions, and node-to-node rebalancing, the client leverages the Lightning Network’s native peer-to-peer gossip protocol via **Liquidity Ads (BOLT 2)**.

* **On-Demand Rapid Gossip Sync (RGS):** To prevent severe battery and network drain on mobile and browser devices, the client disables continuous background gossip syncing. When liquidity is needed, the client queries a compressed **Rapid Gossip Sync (RGS)** server to fetch the active network graph snapshot in seconds.
* **Execution:** The client parses the RGS snapshot to discover nodes advertising public liquidity (`option_will_fund`). The client wallet selects an ad directly from the mesh, initiates a native node-to-node cryptographic handshake, and locks in a dual-funded Layer 1 transaction using its own balances to cover lease parameters.
* **Upfront Lease Terms:** Sourcing capacity via Liquidity Ads triggers a one-time, upfront payment that buys the user a guaranteed protocol-enforced lease duration of **4,032 blocks (approximately one month)**. The peer node is cryptographically locked via a `thaw_height` time-lock parameter, programmatically preventing them from executing an early cooperative closure.

---

## 3. Client-Side Implementation & Routing Rules

The local wallet routing logic prioritizes liquidity sourcing based on real-time channel counts and network states:

1. **Strict Non-Custodial Rule:** Private keys never leave the user's device sandbox. All channel state machines, channel state updates, and cryptographic signatures occur strictly within the local execution environment (IndexedDB for browser, secure file systems for mobile).
2. **Onboarding State Isolation:** The wallet client enforces a structured routing policy to handle onboarding and inbound capacity needs:

```typescript
interface ChannelState {
    total_active_channels: number;
    inbound_capacity_sats: number;
    spendable_sats: number;
}

async function determineLiquidityStrategy(state: ChannelState, incoming_payment_sats: number) {
    if (state.total_active_channels === 0) {
        // 1. Bootstrap onboarding: JIT channel required
        await executeLSPS2JITOnboarding(incoming_payment_sats);
    } else if (state.inbound_capacity_sats < incoming_payment_sats) {
        if (state.spendable_sats >= LEASE_COST_THRESHOLD_SATS) {
            // 2. Sovereign rebalancing: Buy lease via Gossip Ads
            await prioritizeTier3GossipLiquidityAds();
        } else {
            // 3. Automated capacity buying: Buy via LSPS1 API
            await queryLSPS1ProvidersFromRegistry(incoming_payment_sats);
        }
    } else {
        // 4. Normal Lightning routing (LSP trampoline proxy)
        await routeIncomingPaymentNormally();
    }
}
```

3. **L1 Cost Mitigation:** The engine programmatically screens out advertised gossip nodes or LSPS providers where flat setup fees exceed user thresholds, automatically filtering for percentage-based JIT structures or batched channel implementations to shelter the user from Layer 1 mempool fee spikes.

---

## 4. Regulatory Separation Summary

By defining the LSP infrastructure layer as a modular, open-ended matrix of automated network protocols, **Sats and Steel LLC** establishes an ironclad legal barrier:
* The platform does not manage, operate, host, or profit from the liquidity rails.
* The software remains entirely agnostic, enabling users' personal devices to treat commercial nodes, open markets, and raw peer-to-peer network protocols as a singular, unified utility layer.
* No AML/KYC requirements are introduced to the frontend application loop, preserving the frictionless, privacy-centric user experience of Podcasting 2.0 and Value-for-Value audio streaming.
