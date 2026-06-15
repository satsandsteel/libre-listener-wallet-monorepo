import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import {
  initializeWasmFromBinary,
  KeysManager,
  NetworkGraph,
  ProbabilisticScorer,
  ProbabilisticScoringDecayParameters,
  ProbabilisticScoringFeeParameters,
  MultiThreadedLockableScore,
  DefaultRouter,
  DefaultMessageRouter,
  ChainMonitor,
  ChannelManager,
  Option_FilterZ,
  Filter,
  Network,
  Logger as LdkLogger,
  FeeEstimator,
  BroadcasterInterface,
  KVStore,
  MonitorUpdatingPersister,
  BestBlock,
  ChainParameters,
  UserConfig,
  ConfirmationTarget,
} from "lightningdevkit";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EsploraSyncClient } from "../../esplora-client";
import { StorageCache } from "../../storage-cache";
import { SecureStorageProvider } from "../../index";
import * as fs from "fs";
import * as path from "path";

function loadWasmBinary(): Uint8Array {
  const paths = [
    path.resolve(__dirname, "../../../node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(__dirname, "../../../../node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(__dirname, "../../../../../node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(__dirname, "../../../../../node_modules/.pnpm/node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(process.cwd(), "node_modules/lightningdevkit/liblightningjs.wasm"),
    path.resolve(process.cwd(), "../../node_modules/lightningdevkit/liblightningjs.wasm"),
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p);
    }
  }
  throw new Error("Could not find liblightningjs.wasm");
}

const esploraUrl = "https://mock-esplora.api";

// 1. Setup MSW Server for HTTP Mocking
const mswServer = setupServer(
  http.get(`${esploraUrl}/blocks/tip/height`, () => {
    return HttpResponse.text("100");
  }),
  http.get(`${esploraUrl}/blocks/tip/hash`, () => {
    return HttpResponse.text("hash100");
  }),
  http.get(`${esploraUrl}/block-height/:height`, ({ params }) => {
    return HttpResponse.text(`hash${params.height}`);
  }),
  http.get(`${esploraUrl}/block/:hash/header`, () => {
    // Return mock 80-byte header as hex
    return HttpResponse.text("00".repeat(80));
  }),
  http.get(`${esploraUrl}/fee-estimates`, () => {
    return HttpResponse.json({
      "1": 15.0,
      "6": 8.0,
      "36": 4.0,
      "144": 2.0,
    });
  }),
  http.post(`${esploraUrl}/tx`, () => {
    return HttpResponse.text("mock_txid_broadcast");
  })
);

describe("EsploraSyncClient Sync & Fees", () => {
  beforeAll(async () => {
    const bin = loadWasmBinary();
    await initializeWasmFromBinary(bin);
    mswServer.listen({ onUnhandledRequest: "bypass" });
  });

  afterEach(() => {
    mswServer.resetHandlers();
  });

  afterAll(() => {
    mswServer.close();
  });

  it("should retrieve and convert fee estimates correctly", async () => {
    const client = new EsploraSyncClient(esploraUrl);

    // Initial check (empty estimates)
    expect(client.getFeeRate(ConfirmationTarget.LDKConfirmationTarget_UrgentOnChainSweep)).toBe(500);

    // Update estimates
    await client.updateFeeEstimates();

    // Urgent: 15.0 sat/vB * 250 = 3750 sat/1000 WU
    const urgent = client.getFeeRate(ConfirmationTarget.LDKConfirmationTarget_UrgentOnChainSweep);
    expect(urgent).toBe(3750);

    // Medium: 8.0 sat/vB * 250 = 2000 sat/1000 WU
    const medium = client.getFeeRate(ConfirmationTarget.LDKConfirmationTarget_NonAnchorChannelFee);
    expect(medium).toBe(2000);

    // Minimum: 4.0 sat/vB * 250 = 1000 sat/1000 WU
    const min = client.getFeeRate(ConfirmationTarget.LDKConfirmationTarget_ChannelCloseMinimum);
    expect(min).toBe(1000);
  });

  it("should successfully trigger a sync flow on ChannelManager and ChainMonitor", async () => {
    const db = new Map<string, string>();
    const mockStorage: SecureStorageProvider = {
      getItem: async (key) => db.get(key) || null,
      setItem: async (key, val) => {
        db.set(key, val);
      },
      removeItem: async (key) => {
        db.delete(key);
      },
    };

    const cache = new StorageCache(mockStorage);
    await cache.load();

    const kvStore = KVStore.new_impl(cache);
    const seed = new Uint8Array(32);
    seed.fill(1);
    const keysManager = KeysManager.constructor_new(seed, BigInt(1000), 100);
    const syncClient = new EsploraSyncClient(esploraUrl);

    const ldkLogger = LdkLogger.new_impl({
      log(record) {
        // Suppress LDK logs in test
      }
    });

    const feeEstimator = FeeEstimator.new_impl({
      get_est_sat_per_1000_weight(confirmation_target) {
        return syncClient.getFeeRate(confirmation_target);
      }
    });

    const broadcaster = BroadcasterInterface.new_impl({
      broadcast_transactions(txs) {
        // Mock broadcast
      }
    });

    const monitorUpdatingPersister = MonitorUpdatingPersister.constructor_new(
      kvStore,
      ldkLogger,
      BigInt(10),
      keysManager.as_EntropySource(),
      keysManager.as_SignerProvider(),
      broadcaster,
      feeEstimator
    );
    const monitorPersister = monitorUpdatingPersister.as_Persist();

    const chainMonitor = ChainMonitor.constructor_new(
      Option_FilterZ.constructor_some(Filter.new_impl(syncClient)),
      broadcaster,
      ldkLogger,
      feeEstimator,
      monitorPersister
    );

    const netGraph = NetworkGraph.constructor_new(Network.LDKNetwork_Regtest, ldkLogger);
    const scorer = ProbabilisticScorer.constructor_new(
      ProbabilisticScoringDecayParameters.constructor_default(),
      netGraph,
      ldkLogger
    );
    const lockableScore = MultiThreadedLockableScore.constructor_new(scorer.as_Score());
    const router = DefaultRouter.constructor_new(
      netGraph,
      ldkLogger,
      keysManager.as_EntropySource(),
      lockableScore.as_LockableScore(),
      ProbabilisticScoringFeeParameters.constructor_default()
    );
    const msgRouter = DefaultMessageRouter.constructor_new(netGraph, keysManager.as_EntropySource());

    // Sync tip hash/height to init block
    const tipHashHex = await syncClient.fetchTipHash();
    const tipHash = new Uint8Array(32); // mock tip hash bytes
    const tipHeight = await syncClient.fetchTipHeight(); // 100

    const bestBlock = BestBlock.constructor_new(tipHash, tipHeight);
    const params = ChainParameters.constructor_new(Network.LDKNetwork_Regtest, bestBlock);

    const channelManager = ChannelManager.constructor_new(
      feeEstimator,
      chainMonitor.as_Watch(),
      broadcaster,
      router.as_Router(),
      msgRouter.as_MessageRouter(),
      ldkLogger,
      keysManager.as_EntropySource(),
      keysManager.as_NodeSigner(),
      keysManager.as_SignerProvider(),
      UserConfig.constructor_default(),
      params,
      1000
    );

    // Initial sync
    await syncClient.sync(channelManager, chainMonitor);

    // After sync, best block height should be updated to the tip (100)
    const chanManBestBlock = channelManager.current_best_block();
    expect(chanManBestBlock.get_height()).toBe(100);

    // Setup an MSW mock upgrade to block height 102
    mswServer.use(
      http.get(`${esploraUrl}/blocks/tip/height`, () => {
        return HttpResponse.text("102");
      }),
      http.get(`${esploraUrl}/blocks/tip/hash`, () => {
        return HttpResponse.text("hash102");
      })
    );

    // Perform another sync
    await syncClient.sync(channelManager, chainMonitor);

    const chanManBestBlockAfter = channelManager.current_best_block();
    expect(chanManBestBlockAfter.get_height()).toBe(102);

    // Cleanup LDK objects (manually nullify references if needed, LDK wrapper classes do not expose public free() except in specific lock types)
  });
});
