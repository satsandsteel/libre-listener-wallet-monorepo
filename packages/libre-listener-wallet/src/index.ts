import { WalletConfig } from "@libre/shared";
import {
  initializeWasmFromBinary,
  initializeWasmWebFetch,
  FeeEstimator,
  BroadcasterInterface,
  Logger as LdkLogger,
  KVStore,
  MonitorUpdatingPersister,
  ChainMonitor,
  KeysManager,
  UserConfig,
  ChainParameters,
  BestBlock,
  ChannelManager,
  NetworkGraph,
  ProbabilisticScorer,
  ProbabilisticScoringDecayParameters,
  ProbabilisticScoringFeeParameters,
  MultiThreadedLockableScore,
  DefaultRouter,
  DefaultMessageRouter,
  Option_FilterZ,
  Filter,
  Network,
  Level,
  ConfirmationTarget,
  ChannelMonitor,
  Result_NetworkGraphDecodeErrorZ_OK,
  Result_ProbabilisticScorerDecodeErrorZ_OK,
  Result_C2Tuple_ThirtyTwoBytesChannelManagerZDecodeErrorZ_OK,
  Result_CVec_C2Tuple_ThirtyTwoBytesChannelMonitorZZIOErrorZ_OK,
  Option_CVec_ThirtyTwoBytesZZ,
  Option_SocketAddressZ,
  Init,
  UtilMethods,
} from "lightningdevkit";
import { StorageCache, bytesToHex, hexToBytes } from "./storage-cache";
import { EsploraSyncClient } from "./esplora-client";

export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export interface SecureStorageProvider {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface WebSocketConnection {
  send(data: Uint8Array): void;
  close(): void;
  onmessage?: (data: Uint8Array) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;
}

export interface WebSocketStreamProvider {
  connect(address: string, port: number): Promise<WebSocketConnection>;
}

let isWasmInitialized = false;

function getSecureRandomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len);
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error("Secure random bytes generation not supported in this environment");
  }
  return bytes;
}

export class LibreListenerWallet {
  private config: WalletConfig;
  private logger?: Logger;
  private storage: SecureStorageProvider;
  private socketProvider: WebSocketStreamProvider;
  private isRunning: boolean = false;

  private wasmBinary?: Uint8Array;
  private wasmUrl?: string;

  private storageCache?: StorageCache;
  private syncClient?: EsploraSyncClient;
  private keysManager?: KeysManager;
  private chainMonitor?: ChainMonitor;
  private channelManager?: ChannelManager;
  private networkGraph?: NetworkGraph;
  private scorer?: ProbabilisticScorer;
  private lockableScore?: MultiThreadedLockableScore;
  private monitorUpdatingPersister?: MonitorUpdatingPersister;
  private syncIntervalId?: any;

  constructor(options: {
    config: WalletConfig;
    storage: SecureStorageProvider;
    socketProvider: WebSocketStreamProvider;
    logger?: Logger;
    wasmBinary?: Uint8Array;
    wasmUrl?: string;
  }) {
    this.config = options.config;
    this.storage = options.storage;
    this.socketProvider = options.socketProvider;
    this.logger = options.logger;
    this.wasmBinary = options.wasmBinary;
    this.wasmUrl = options.wasmUrl;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger?.warn("Wallet is already running");
      return;
    }
    this.logger?.info(`Starting LDK Node on network: ${this.config.network}`);

    // 1. Initialize WASM
    if (!isWasmInitialized) {
      if (this.wasmBinary) {
        await initializeWasmFromBinary(this.wasmBinary);
        isWasmInitialized = true;
      } else if (this.wasmUrl) {
        await initializeWasmWebFetch(this.wasmUrl);
        isWasmInitialized = true;
      } else {
        throw new Error("No WASM binary or URL provided for LDK WASM initialization");
      }
    }

    // 2. Load storage cache
    this.storageCache = new StorageCache(this.storage);
    await this.storageCache.load();

    const kvStore = KVStore.new_impl(this.storageCache);

    // 3. Setup key derivation & KeysManager
    let seedHex = await this.storage.getItem("ldk_seed");
    let seed: Uint8Array;
    if (!seedHex) {
      seed = getSecureRandomBytes(32);
      seedHex = bytesToHex(seed);
      await this.storage.setItem("ldk_seed", seedHex);
    } else {
      seed = hexToBytes(seedHex);
    }
    this.keysManager = KeysManager.constructor_new(
      seed,
      BigInt(Math.floor(Date.now() / 1000)),
      Math.floor(Math.random() * 100000)
    );

    // 4. Setup Esplora sync client
    this.syncClient = new EsploraSyncClient(this.config.esploraUrl, this.logger);

    // 5. Instantiate LDK Logger, FeeEstimator, Broadcaster
    const self = this;
    const ldkLogger = LdkLogger.new_impl({
      log(record) {
        const level = record.get_level();
        const args = record.get_args();
        const module = record.get_module_path();
        const message = `[LDK][${module}] ${args}`;
        
        switch (level) {
          case Level.LDKLevel_Error:
            self.logger?.error(message);
            break;
          case Level.LDKLevel_Warn:
            self.logger?.warn(message);
            break;
          case Level.LDKLevel_Info:
            self.logger?.info(message);
            break;
          case Level.LDKLevel_Debug:
          case Level.LDKLevel_Trace:
          case Level.LDKLevel_Gossip:
          default:
            // Optional debug logging, can map to info/debug
            self.logger?.info(message);
            break;
        }
      }
    });

    const feeEstimator = FeeEstimator.new_impl({
      get_est_sat_per_1000_weight(confirmation_target) {
        return self.syncClient!.getFeeRate(confirmation_target);
      }
    });

    const broadcaster = BroadcasterInterface.new_impl({
      broadcast_transactions(txs) {
        for (const tx of txs) {
          self.syncClient!.broadcastTransaction(tx).catch(err => {
            self.logger?.error(`Failed to broadcast transaction: ${err.message}`);
          });
        }
      }
    });

    // 6. Setup MonitorUpdatingPersister & ChainMonitor
    this.monitorUpdatingPersister = MonitorUpdatingPersister.constructor_new(
      kvStore,
      ldkLogger,
      BigInt(10),
      this.keysManager.as_EntropySource(),
      this.keysManager.as_SignerProvider(),
      broadcaster,
      feeEstimator
    );
    const monitorPersister = this.monitorUpdatingPersister.as_Persist();

    this.chainMonitor = ChainMonitor.constructor_new(
      Option_FilterZ.constructor_some(Filter.new_impl(this.syncClient)),
      broadcaster,
      ldkLogger,
      feeEstimator,
      monitorPersister
    );

    // 7. Load existing channel monitors if any
    const monitorsReadRes = this.monitorUpdatingPersister.read_all_channel_monitors_with_updates();
    let channelMonitors: ChannelMonitor[] = [];
    if (monitorsReadRes.is_ok()) {
      const monitorsList = (monitorsReadRes as Result_CVec_C2Tuple_ThirtyTwoBytesChannelMonitorZZIOErrorZ_OK).res;
      channelMonitors = monitorsList.map(tuple => tuple.get_b());
      this.logger?.info(`Loaded ${channelMonitors.length} channel monitors from storage`);
    }

    // 8. Load or construct NetworkGraph & Scorer
    let ldkNetwork: Network;
    switch (this.config.network) {
      case "mainnet":
        ldkNetwork = Network.LDKNetwork_Bitcoin;
        break;
      case "testnet":
        ldkNetwork = Network.LDKNetwork_Testnet;
        break;
      case "regtest":
        ldkNetwork = Network.LDKNetwork_Regtest;
        break;
      case "signet":
        ldkNetwork = Network.LDKNetwork_Signet;
        break;
      default:
        throw new Error(`Unsupported network: ${this.config.network}`);
    }

    const graphHex = await this.storage.getItem("network_graph");
    if (graphHex) {
      const readRes = NetworkGraph.constructor_read(hexToBytes(graphHex), ldkLogger);
      if (readRes.is_ok()) {
        this.networkGraph = (readRes as Result_NetworkGraphDecodeErrorZ_OK).res;
        this.logger?.info("Loaded NetworkGraph from storage");
      }
    }
    if (!this.networkGraph) {
      this.networkGraph = NetworkGraph.constructor_new(ldkNetwork, ldkLogger);
      this.logger?.info("Created new NetworkGraph");
    }

    const scorerHex = await this.storage.getItem("scorer");
    if (scorerHex) {
      const readRes = ProbabilisticScorer.constructor_read(
        hexToBytes(scorerHex),
        ProbabilisticScoringDecayParameters.constructor_default(),
        this.networkGraph,
        ldkLogger
      );
      if (readRes.is_ok()) {
        this.scorer = (readRes as Result_ProbabilisticScorerDecodeErrorZ_OK).res;
        this.logger?.info("Loaded Scorer from storage");
      }
    }
    if (!this.scorer) {
      this.scorer = ProbabilisticScorer.constructor_new(
        ProbabilisticScoringDecayParameters.constructor_default(),
        this.networkGraph,
        ldkLogger
      );
      this.logger?.info("Created new Scorer");
    }

    this.lockableScore = MultiThreadedLockableScore.constructor_new(this.scorer.as_Score());

    // 9. Setup Router and MessageRouter
    const router = DefaultRouter.constructor_new(
      this.networkGraph,
      ldkLogger,
      this.keysManager.as_EntropySource(),
      this.lockableScore.as_LockableScore(),
      ProbabilisticScoringFeeParameters.constructor_default()
    );

    const msgRouter = DefaultMessageRouter.constructor_new(
      this.networkGraph,
      this.keysManager.as_EntropySource()
    );

    // 10. Load or construct ChannelManager
    const managerHex = await this.storage.getItem("channel_manager");
    if (managerHex) {
      const readRes = UtilMethods.constructor_C2Tuple_ThirtyTwoBytesChannelManagerZ_read(
        hexToBytes(managerHex),
        this.keysManager.as_EntropySource(),
        this.keysManager.as_NodeSigner(),
        this.keysManager.as_SignerProvider(),
        feeEstimator,
        this.chainMonitor.as_Watch(),
        broadcaster,
        router.as_Router(),
        msgRouter.as_MessageRouter(),
        ldkLogger,
        UserConfig.constructor_default(),
        channelMonitors
      );

      if (readRes.is_ok()) {
        const tuple = (readRes as Result_C2Tuple_ThirtyTwoBytesChannelManagerZDecodeErrorZ_OK).res;
        this.channelManager = tuple.get_b();
        this.logger?.info("Successfully loaded ChannelManager from storage");
      } else {
        this.logger?.error("Failed to load ChannelManager from storage, constructing fresh");
      }
    }

    if (!this.channelManager) {
      const tipHeight = await this.syncClient.fetchTipHeight();
      const tipHashHex = await this.syncClient.fetchTipHash();
      const tipHash = hexToBytes(tipHashHex);

      const bestBlock = BestBlock.constructor_new(tipHash, tipHeight);
      const params = ChainParameters.constructor_new(ldkNetwork, bestBlock);

      this.channelManager = ChannelManager.constructor_new(
        feeEstimator,
        this.chainMonitor.as_Watch(),
        broadcaster,
        router.as_Router(),
        msgRouter.as_MessageRouter(),
        ldkLogger,
        this.keysManager.as_EntropySource(),
        this.keysManager.as_NodeSigner(),
        this.keysManager.as_SignerProvider(),
        UserConfig.constructor_default(),
        params,
        Math.floor(Date.now() / 1000)
      );
      this.logger?.info("Successfully bootstrapped a fresh ChannelManager");
    }

    // 11. Initial sync with Esplora
    await this.syncClient.sync(this.channelManager, this.chainMonitor);

    // 12. Setup background sync loop
    this.syncIntervalId = setInterval(() => {
      if (this.channelManager && this.chainMonitor) {
        this.syncClient!.sync(this.channelManager, this.chainMonitor).catch(err => {
          this.logger?.error(`Background sync error: ${err.message}`);
        });
      }
    }, 30000);

    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger?.warn("Wallet is not running");
      return;
    }
    this.logger?.info("Stopping LDK Node...");

    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = undefined;
    }

    // Persist final states
    if (this.channelManager && this.networkGraph && this.scorer) {
      try {
        this.logger?.info("Saving final state to storage...");
        const managerBytes = this.channelManager.write();
        await this.storage.setItem("channel_manager", bytesToHex(managerBytes));

        const graphBytes = this.networkGraph.write();
        await this.storage.setItem("network_graph", bytesToHex(graphBytes));

        const scorerBytes = this.scorer.write();
        await this.storage.setItem("scorer", bytesToHex(scorerBytes));
      } catch (err) {
        this.logger?.error(`Failed to save state on shutdown: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Free pointers to prevent WASM leaks
    this.channelManager = undefined;
    this.chainMonitor = undefined;
    this.keysManager = undefined;
    this.networkGraph = undefined;
    this.scorer = undefined;
    this.lockableScore = undefined;
    this.monitorUpdatingPersister = undefined;

    this.isRunning = false;
  }

  async sync(): Promise<void> {
    if (!this.isRunning || !this.channelManager || !this.chainMonitor) {
      throw new Error("Wallet is not running");
    }
    await this.syncClient!.sync(this.channelManager, this.chainMonitor);
  }

  status(): "Stopped" | "Running" {
    return this.isRunning ? "Running" : "Stopped";
  }

  // --- Exposed internal objects for Milestone 3+ use ---
  
  getChannelManager(): ChannelManager | undefined {
    return this.channelManager;
  }

  getChainMonitor(): ChainMonitor | undefined {
    return this.chainMonitor;
  }

  getSyncClient(): EsploraSyncClient | undefined {
    return this.syncClient;
  }

  getKeysManager(): KeysManager | undefined {
    return this.keysManager;
  }
}
export { StorageCache, bytesToHex, hexToBytes } from "./storage-cache";
export { EsploraSyncClient } from "./esplora-client";
export { WalletConfig } from "@libre/shared";
