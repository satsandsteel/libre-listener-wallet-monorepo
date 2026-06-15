You are an AI software engineering agent pair-programming with the user to develop the **Libre Listener Wallet** project. Before generating any code or proposing changes, read this document to orient yourself on the codebase structure and mandatory contracts.

---

## Step 1: Read the Source Contracts

The definitive specifications, design protocols, and guardrails are documented in the `ai/` folder. Your **first** action must be to read all documents in these directories:

1.  **System Specs & Roadmap**:
    *   [libre-listener-wallet-architecture.md](ai/reference/this-monorepo/libre-listener-wallet-architecture.md) — Multi-Tier Liquidity Engine (LSPS2, LSPS1, Gossip Ads).
    *   [libre-listener-wallet-infrastructure.md](ai/reference/this-monorepo/libre-listener-wallet-infrastructure.md) — Self-hosted vs. outsourced service dependencies.
    *   [libre-listener-wallet-tech-stack.md](ai/reference/this-monorepo/libre-listener-wallet-tech-stack.md) — Typescript, tsup, Vitest, MSW, and bLIP-10 BoostRecords.
    *   [libre-listener-wallet-roadmap.md](ai/reference/this-monorepo/libre-listener-wallet-roadmap.md) — Milestones tracking.
2.  **Hard Development Contracts**:
    *   [guardrails.md](ai/contracts/guardrails.md) — Security rules and architectural boundaries.
    *   [project-conventions.md](ai/contracts/project-conventions.md) — DRY rules, file naming, patterns, and barrel exports.
    *   [testing-strategy.md](ai/contracts/testing-strategy.md) — Test requirements and TDD workflow.

---

## Step 2: Critical Guardrails to Keep in Mind

While the docs contain full specifications, you must strictly enforce these critical guardrails. Violating them constitutes a high-priority system bug:

*   **Absolute Key Isolation**: Seed words and private keys must **never** leave the client-side execution sandbox (IndexedDB or native Keychain). Do not transmit keys or HTLC preimages over sockets, HTTP APIs, or print them in logs.
*   **No LDK Over-Mocking**: Do **not** mock LDK internals (e.g. `vi.mock('lightningdevkit')` or LDK JS wrapper objects). Tests must run against the actual LDK library; mock the network socket transport layer or API servers (via MSW) instead.
*   **Zero-Custody & DB Isolation**: The `libre-nwc-push-gateway` must remain completely stateless regarding wallet credentials and must use a separate, standalone database (SQLite/Postgres) isolated from the host app's database.
*   **Strict Host Bindings**: All testing services (in `docker-compose.yml` or gateways) must explicitly map external ports to `127.0.0.1` (localhost only) to prevent public network exposure of testing RPCs.

---

## Step 3: Workspace Orientation & Sanity Check

The monorepo contains the following workspace layout:
*   `packages/shared`: Shared types, request schemas, and serializations.
*   `packages/libre-listener-wallet`: Client-side SDK using LDK.
*   `packages/libre-nwc-push-gateway`: Offline background notifications relay daemon.


# Never commit without human approval

Do not make an implementation plan or make any changes yet