import { beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";

// Initialize MSW Mock Server for HTTP request interception (e.g. mock Esplora or LSP endpoints)
export const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
