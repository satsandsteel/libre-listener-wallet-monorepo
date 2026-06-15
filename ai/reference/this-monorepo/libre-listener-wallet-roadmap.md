# Development Roadmap: Libre Listener Wallet (`libre-listener-wallet`)

This document outlines the step-by-step roadmap to build, test, and release the Libre Listener Wallet SDK and its supporting infrastructure.

---

```
[Milestone 1: Stack & Regtest] ---> [Milestone 2: LDK WASM Node] ---> [Milestone 3: LSPS1/2 Onboarding]
                                                                                |
[Milestone 6: Push/Offline NWC] <--- [Milestone 5: NWC Portability] <--- [Milestone 4: Keysend & TLVs]
```

---

## Milestone 1: Development Environment & Core Stack Setup
*Goal: Establish the monorepo workspaces, package structures, and local integration test networks.*

- [x] **Monorepo & Workspace Setup:**
  - [x] Initialize the root monorepo directory with workspaces configuration (`pnpm-workspace.yaml` or npm `workspaces` in root `package.json`).
  - [x] Configure **Turborepo** (`turbo.json`) for pipeline task execution (build, lint, test).
  - [x] Create package directories: `packages/libre-listener-wallet`, `packages/libre-nwc-push-gateway`, and `packages/shared`.
  - [x] Configure TypeScript project references across workspaces.
  - [x] Configure `tsup` for bundle compilation and `.d.ts` generation.
- [x] **Local Regtest Environment (Docker Compose):**
  - [x] Set up a `docker-compose.yml` for local testing.
  - [x] Include `bitcoind` (configured for Regtest).
  - [x] Include `Esplora API` (indexes Regtest chain for LDK).
  - [x] Include a mock LSP Node (`clightning` or `lnd`) supporting zero-conf.
  - [x] Include `websockify` (TCP-to-WebSocket bridge) to allow browser socket connections.
- [x] **Testing Framework Setup:**
  - [x] Configure `vitest` with `jsdom` (to simulate IndexedDB in tests).
  - [x] Integrate MSW (Mock Service Worker) for API mocking.

---

## Milestone 2: Core SDK Architecture & WASM Node Engine
*Goal: Initialize the client-side LDK WASM node and enable state persistence.*

- [x] **Clean Architecture Interfaces:**
  - Define `SecureStorageProvider` interface (IndexedDB vs. mobile keychain).
  - Define `WebSocketStreamProvider` interface (browser WebSockets vs. mobile TCP).
- [x] **LDK Node Wrapper:**
  - Install `@lightningdevkit/lightningdevkit` (LDK JS bindings).
  - Build the LDK Node manager class responsible for setup, start, and shutdown.
- [x] **Chain Sync Integration:**
  - Build the Esplora sync client implementing LDK's `Confirm` and `Filter` interfaces.
  - Verify client can query block headers, transaction inputs, and script filters from Esplora.
- [x] **State Persistence & Recovery:**
  - Implement client state serialization.
  - Verify node can do a "cold boot," save state to IndexedDB, restart, and restore state cleanly.

---

## Milestone 3: Multi-Tier Liquidity Engine (LSPS1/LSPS2 Onboarding)
*Goal: Establish channel onboarding for new users with a 0-sat balance.*

- [ ] **LSP Registry Client:**
  - Implement client fetcher for `.well-known/lightning-providers.json`.
  - Handle fee-quoting fallback logic across whitelisted LSPs.
- [ ] **Tier 1 (LSPS2 JIT Channel):**
  - Build client invoice generator that fetches routing hints and JIT channel params from the LSP.
  - Verify client can receive incoming payments via Lightning.
  - *Integration Test:* Trigger a payment from the mock LSP in Docker to the SDK wallet, verify the LSP opens a zero-conf channel, and verify the client receives the remaining sats.
- [ ] **Tier 2 (LSPS1 Capacity Market):**
  - Build query client to purchase pre-planned inbound/outbound capacity from the whitelisted LSPs via HTTPS APIs.
- [ ] **Example App Setup (`packages/example-app`):**
  - Scaffold a Vite-based TypeScript workspace for a demo client application.
  - Implement dynamic config settings input form (e.g., custom lightning-providers.json path/URL, Esplora URL, Websockify URL) to avoid hardcoding `v4vmusic.com`.
  - Render an interactive console showing the LDK node's status: sync state, node pubkey, connected peers, and open channels.
  - Provide a UI form to request incoming LSPS2 JIT invoices and display real-time payment resolution.

---

## Milestone 4: Value-for-Value Payments (Keysend & TLVs)
*Goal: Enable streaming micropayments and metadata transmission.*

- [ ] **Keysend Payments API:**
  - Implement `sendKeysendPayment` wrapper exposing LDK's keysend routing parameters.
- [ ] **Custom TLV Encoder/Decoder:**
  - Implement serialization for **TLV Type `7629169`** (bLIP-10 podcast metadata and boostagrams).
  - Implement serialization for **TLV Type `7629175`** (podcast index ID).
  - Support dynamic custom keys/values (needed for split routing).
- [ ] **Multi-Recipient Splits:**
  - Build helper logic to split a single payment across multiple destination keysends (e.g., 90% to creator, 10% to app publisher) using the same `boost_uuid`.
- [ ] **Example App - Audio Player & Micropayments UI:**
  - Add an audio player component to stream tracks/episodes.
  - Integrate periodic streaming micropayments (keysends) based on active audio playback.
  - Add a "Boost" interface enabling the user to send keysend payments with custom messages (Boostagram metadata TLVs).

---

## Milestone 5: Nostr Wallet Connect (NWC / NIP-47) Portability
*Goal: Allow users to control their wallet from external music/podcast apps while the PWA is open.*

- [ ] **Pairing URI Generator:**
  - Implement pairing generation creating the `nostr+walletconnect://` string.
- [ ] **Nostr Relay Listener (NIP-47):**
  - Integrate `nostr-tools`.
  - Listen for encrypted Nostr events requesting wallet info, balance, invoice creation, and keysends.
- [ ] **Security & Permissions:**
  - Implement spending limits (e.g. max sats per day/transaction) and host app permission whitelisting.
- [ ] **Example App - NWC Dashboard:**
  - Build a settings interface for generating, displaying (as text and QR code), and managing active NWC pairing connections.
  - Allow local wallet authorization, checking transaction histories, and configuring limits directly from the dashboard.

---

## Milestone 6: Offline Background Wake-Ups (Libre NWC Push Gateway)
*Goal: Allow NWC payments to succeed even if the PWA is closed.*

- [ ] **Libre NWC Push Gateway Microservice:**
  - Build `libre-nwc-push-gateway` as a standalone Node.js app using SQLite/Postgres.
  - Implement Nostr relay listener to track encrypted requests for offline clients.
  - Implement Web Push API triggers.
- [ ] **PWA Service Worker integration:**
  - Configure the PWA Service Worker to handle the `push` event.
  - Optimize the LDK boot and sync sequence for rapid startup (must complete under 15 seconds).
- [ ] **Fallback "Tap to Pay" UX:**
  - If background sync fails or exceeds the OS execution window, fallback to triggering a push notification prompt that opens the PWA when clicked to finalize payment.
- [ ] **Example App - PWA & Push Service Integration:**
  - Integrate Service Worker registration and Web Push notifications permission prompt.
  - Add simulated logs to trace background wake-ups and verify that offline NWC payments trigger push events successfully.
