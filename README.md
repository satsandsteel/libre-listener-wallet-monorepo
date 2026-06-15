# Libre Listener Wallet Monorepo

> [!WARNING]
> **Active Development**: This project is in active development and is **not yet functional**. Do not attempt to run this in production.

> [!CAUTION]
> **Experimental Software**: This software is experimental. **Loss of Bitcoin is highly likely.** Use at your own risk.

---

The **Libre Listener Wallet** is a zero-infrastructure, non-custodial Bitcoin Lightning Network implementation. It is designed to run directly inside browser/PWA sandboxes and native mobile wrappers, bringing friction-free Lightning payments to the Podcasting 2.0 and Value-for-Value (`v4vmusic.com`) music streaming ecosystem.

## Expected User Experience

1.  **Onboarding ("Give me a wallet")**: The user clicks the button. Locally in the browser sandbox, the SDK generates a new BIP39 seed phrase and initializes the LDK WASM client node (state is persisted in IndexedDB). The user now has a fully sovereign wallet with a `0 sat` balance.
2.  **Funding (First Deposit)**: The user requests an invoice to fund their new wallet. Since they have no open channels, the SDK requests routing hints from a whitelisted LSP (sourced from the `.well-known` providers registry) using the **LSPS2 JIT Channel** protocol.
3.  **Automatic Liquidity**: The user pays the invoice from an external service (e.g., Strike, Cash App). The LSP intercepts the payment, opens a zero-confirmation channel to the browser node, deducts the channel fee atomically, and routes the remaining balance.
4.  **Instant Spendability**: The channel is instantly active. The user now has sovereign control of their sats directly in their browser.
5.  **V4V Streaming & Boostagrams**: When playing a song or podcast, the user clicks "Boost". The browser node constructs a Keysend payment, injects the custom bLIP-10 metadata (TLV record `7629169` for Boost data and `7629175` for the Feed GUID), signs it locally, and routes it instantly.

## Workspace Packages

The repository is structured as a TypeScript monorepo managed by `pnpm` and Turborepo:

*   **[`packages/shared`](ai/prompts/primer-prompt.md)**: Common types, request schemas, and serializations shared between the SDK and push gateway.
*   **[`packages/libre-listener-wallet`](ai/prompts/primer-prompt.md)**: The client-side SDK wrapping LDK (Lightning Development Kit) WASM and native C/Rust bindings.
*   **[`packages/libre-nwc-push-gateway`](ai/prompts/primer-prompt.md)**: The server-side, stateless notification gateway used to wake up offline PWAs for Nostr Wallet Connect (NWC) requests.

---

## Developer & AI Agent Orientation

If you are a developer or an AI coding assistant working on this codebase:
*   Read the project contracts and design roadmap located in the [**`ai/`**](ai/prompts/primer-prompt.md) directory.
*   Refer to the [**`ai/prompts/primer-prompt.md`**](ai/prompts/primer-prompt.md) onboarding prompt to understand critical security constraints, port configurations, and testing rules.

---

## Quick Start

### 1. Build and Compile Workspaces
Installs dependencies and runs the compiler pipelines (`tsup`) to build code targets:
```bash
pnpm install
pnpm build
```

### 2. Run Test Suites
Executes Vitest tests across all packages:
```bash
pnpm test
```

### 3. Spin Up Local Regtest Sandbox
Runs local integration testing services (`bitcoind`, `electrs` indexer, `lnd` mock LSP, and `websockify` TCP bridge proxy):
```bash
docker compose up -d
```
All ports are bound strictly to `127.0.0.1` for local safety.
