# Testing Strategy: Libre Listener Wallet Monorepo

To ensure high-integrity code generation by AI agents, testing must follow strict rules, prioritizing deterministic integration tests over fragile mocking.

---

## 1. Testing Stack & Environment

* **Test Runner:** **Vitest** (configured inside each subpackage).
* **DOM Simulation:** `jsdom` (used in browser WASM tests to simulate IndexedDB storage states).
* **HTTP Mocking:** **MSW (Mock Service Worker)** for intercepting outbound HTTP API calls to LSPs or Esplora.
* **Command:** `pnpm test` (run from root) must pass before pushing code.

---

## 2. Hard Rules

### 2.1. No Over-Mocking of the LDK Node
* **The Rule:** You must **never** mock LDK internals, `vi.mock('@lightningdevkit/lightningdevkit')`, or internal channel managers.
* **Why:** Fake mocks result in "green tests" that immediately crash in production because LDK's state machine does not match the mocked return types.
* **How to Test:** Use the actual LDK WASM library in your unit tests. If you need to test payment routing or channel state transitions, you must run an integration test against a local node, or mock the network sockets, not the internal JS code.

### 2.2. No Mocking of the Database (Push Gateway)
* **The Rule:** The `libre-nwc-push-gateway` tests must run against a **real, isolated test database** (such as a local SQLite in-memory instance or a dedicated test Postgres container).
* **Clean State:** Truncate tables before and after each test suite.

### 2.3. Test Behavior, Not Implementation
* **The Rule:** Do not assert on private method execution order, log formatting, or internal variable states.
* **Assert Outcomes:** Check the resulting state (e.g., node status transitions from `Stopped` to `Running`, channel monitor payload is stored in IndexedDB, or NWC response is successfully posted to the mock Nostr relay).

### 2.4. Test-Driven Development (TDD) Lifecycle
* **The Rule:** All feature implementations and bug fixes must follow the strict three-phase TDD red-green-refactor cycle:
  1. **Red (Write the Test):** Write a failing unit or integration test before implementing the logic or fixing the bug. Run the test and verify it fails for the expected reason (e.g., compile error, type mismatch, or missing assertion).
  2. **Green (Write the Code):** Write the minimal production code necessary to make the new test pass. Do not write ahead or add extraneous code. Verify the test suite is 100% green.
  3. **Refactor (Clean it up):** Clean up the code (remove duplication, apply design patterns, ensure DRY principles) while keeping the test suite green.
* **No Feature Code without Tests:** Agents must never generate code modifications in production files without adding or updating the corresponding tests in the same task.

---

## 3. Test Categories & Templates

### 3.1. Unit Tests (LDK Logic, TLV Encoders, Zod Schemas)
Unit tests must verify data transformations and input boundaries.

```typescript
// Example: Zod validation test template
test("valid input passes", () => {
  const result = nwcRequestSchema.safeParse(validInput);
  expect(result.success).toBe(true);
});

test("invalid input throws expected error", () => {
  const result = nwcRequestSchema.safeParse(invalidInput);
  expect(result.success).toBe(false);
  expect(result.error.issues[0].message).toContain("Expected...");
});
```

### 3.2. HTTP Mocking via MSW
For client-side tests that request fee quotes from an LSP or query blockchain data from Esplora:

```typescript
// Example: Intercepting LSP queries via MSW
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  http.post('https://lsp-endpoint.com/api/v1/quote', () => {
    return HttpResponse.json({
      min_fee_msat: 250000,
      proportional_fee_ppm: 1000
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 3.3. Local Integration Tests (Regtest Workflow)
The integration test suite in `packages/libre-listener-wallet/src/tests/integration` runs against the docker-compose regtest environment:

```typescript
// Example: Dynamic integration test sequence
test("onboard user via LSPS2 zero-conf", async () => {
  // 1. Initialize client LDK Node
  const node = await initLDKNode();
  
  // 2. Generate invoice with routing hints
  const invoice = await node.createJITInvoice(20000);
  
  // 3. Instruct Mock LSP in Docker to pay invoice
  await mockLspPayInvoice(invoice);
  
  // 4. Generate block on regtest to settle
  await generateRegtestBlocks(1);
  
  // 5. Assert channel is active and balance matches
  const balance = await node.getBalance();
  expect(balance).toBe(20000 - EXPECTED_LSP_FEE);
});
```
