import {
  FilterInterface,
  WatchedOutput,
  TwoTuple_usizeTransactionZ,
  ChannelManager,
  ChainMonitor,
  ConfirmationTarget,
  Option_ThirtyTwoBytesZ_Some,
} from "lightningdevkit";
import { Logger } from "./index";
import { bytesToHex, hexToBytes } from "./storage-cache";

export interface EsploraTxStatus {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}

export interface EsploraTx {
  txid: string;
  version: number;
  locktime: number;
  vin: any[];
  vout: any[];
  size: number;
  weight: number;
  fee: number;
  status: EsploraTxStatus;
}

export interface EsploraMerkleProof {
  block_height: number;
  merkle: string[];
  pos: number;
}

export interface EsploraSpendInfo {
  spent: boolean;
  txid?: string;
  vin?: number;
  status?: EsploraTxStatus;
}

export class EsploraSyncClient implements FilterInterface {
  private esploraUrl: string;
  private logger?: Logger;
  private registeredTxs: Map<string, Uint8Array> = new Map(); // txid hex -> scriptPubKey
  private registeredOutputs: Map<string, WatchedOutput> = new Map(); // outpoint hex (txid:index) -> WatchedOutput

  constructor(esploraUrl: string, logger?: Logger) {
    this.esploraUrl = esploraUrl.replace(/\/$/, "");
    this.logger = logger;
  }

  // --- FilterInterface implementation ---

  register_tx(txid: Uint8Array, script_pubkey: Uint8Array): void {
    const txidHex = bytesToHex(txid);
    this.logger?.info(`Registering tx filter: ${txidHex}`);
    this.registeredTxs.set(txidHex, script_pubkey);
  }

  register_output(output: WatchedOutput): void {
    const outpoint = output.get_outpoint();
    const txidHex = bytesToHex(outpoint.get_txid());
    const index = outpoint.get_index();
    const outpointHex = `${txidHex}:${index}`;
    this.logger?.info(`Registering output filter: ${outpointHex}`);
    this.registeredOutputs.set(outpointHex, output);
  }

  // --- Custom sync methods ---

  getRegisteredTxs(): Map<string, Uint8Array> {
    return this.registeredTxs;
  }

  getRegisteredOutputs(): Map<string, WatchedOutput> {
    return this.registeredOutputs;
  }

  async fetchTipHeight(): Promise<number> {
    const res = await fetch(`${this.esploraUrl}/blocks/tip/height`);
    if (!res.ok) throw new Error(`Failed to fetch tip height: ${res.statusText}`);
    const text = await res.text();
    return parseInt(text.trim(), 10);
  }

  async fetchTipHash(): Promise<string> {
    const res = await fetch(`${this.esploraUrl}/blocks/tip/hash`);
    if (!res.ok) throw new Error(`Failed to fetch tip hash: ${res.statusText}`);
    const text = await res.text();
    return text.trim();
  }

  async fetchBlockHash(height: number): Promise<string> {
    const res = await fetch(`${this.esploraUrl}/block-height/${height}`);
    if (!res.ok) throw new Error(`Failed to fetch block hash at height ${height}: ${res.statusText}`);
    const text = await res.text();
    return text.trim();
  }

  async fetchBlockHeader(height: number): Promise<string> {
    const hash = await this.fetchBlockHash(height);
    const res = await fetch(`${this.esploraUrl}/block/${hash}/header`);
    if (!res.ok) throw new Error(`Failed to fetch block header for hash ${hash}: ${res.statusText}`);
    const text = await res.text();
    return text.trim();
  }

  async fetchTx(txid: string): Promise<EsploraTx | null> {
    const res = await fetch(`${this.esploraUrl}/tx/${txid}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to fetch tx ${txid}: ${res.statusText}`);
    return res.json() as Promise<EsploraTx>;
  }

  async fetchRawTx(txid: string): Promise<string> {
    const res = await fetch(`${this.esploraUrl}/tx/${txid}/hex`);
    if (!res.ok) throw new Error(`Failed to fetch raw tx hex ${txid}: ${res.statusText}`);
    const text = await res.text();
    return text.trim();
  }

  async fetchMerkleProof(txid: string): Promise<EsploraMerkleProof | null> {
    const res = await fetch(`${this.esploraUrl}/tx/${txid}/merkle-proof`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to fetch merkle proof for tx ${txid}: ${res.statusText}`);
    return res.json() as Promise<EsploraMerkleProof>;
  }

  async fetchSpendInfo(txid: string, index: number): Promise<EsploraSpendInfo | null> {
    const res = await fetch(`${this.esploraUrl}/tx/${txid}/outspends`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to fetch outspends for tx ${txid}: ${res.statusText}`);
    const outspends = (await res.json()) as EsploraSpendInfo[];
    return outspends[index] || null;
  }

  async broadcastTransaction(txBytes: Uint8Array): Promise<void> {
    const hex = bytesToHex(txBytes);
    const res = await fetch(`${this.esploraUrl}/tx`, {
      method: "POST",
      body: hex,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to broadcast transaction: ${text}`);
    }
    this.logger?.info(`Successfully broadcasted transaction: ${await res.text()}`);
  }

  private cachedFeeEstimates: Record<string, number> = {};

  async fetchFeeEstimates(): Promise<Record<string, number>> {
    const res = await fetch(`${this.esploraUrl}/fee-estimates`);
    if (!res.ok) throw new Error(`Failed to fetch fee estimates: ${res.statusText}`);
    return res.json() as Promise<Record<string, number>>;
  }

  async updateFeeEstimates(): Promise<void> {
    try {
      this.cachedFeeEstimates = await this.fetchFeeEstimates();
    } catch (e) {
      this.logger?.warn(`Failed to update fee estimates: ${e instanceof Error ? e.message : e}`);
    }
  }

  getFeeRate(target: ConfirmationTarget): number {
    let blockTarget = 6; // Default to 6 blocks confirmation (medium priority)
    
    switch (target) {
      case ConfirmationTarget.LDKConfirmationTarget_UrgentOnChainSweep:
        blockTarget = 1;
        break;
      case ConfirmationTarget.LDKConfirmationTarget_AnchorChannelFee:
      case ConfirmationTarget.LDKConfirmationTarget_NonAnchorChannelFee:
      case ConfirmationTarget.LDKConfirmationTarget_OutputSpendingFee:
        blockTarget = 6;
        break;
      case ConfirmationTarget.LDKConfirmationTarget_ChannelCloseMinimum:
        blockTarget = 36;
        break;
      default:
        blockTarget = 6;
    }

    const feeRate = this.cachedFeeEstimates[blockTarget] || this.cachedFeeEstimates["6"] || this.cachedFeeEstimates["144"] || 2.0;
    return Math.max(253, Math.round(feeRate * 250));
  }

  async sync(channelManager: ChannelManager, chainMonitor: ChainMonitor): Promise<void> {
    await this.updateFeeEstimates();
    const tipHeight = await this.fetchTipHeight();
    const tipHashHex = await this.fetchTipHash();

    const confirmManager = channelManager.as_Confirm();
    const confirmMonitor = chainMonitor.as_Confirm();

    // Get current best block in manager
    const managerBestBlock = channelManager.current_best_block();
    let bestHeight = managerBestBlock.get_height();
    let bestHashHex = bytesToHex(managerBestBlock.get_block_hash());

    this.logger?.info(`Syncing LDK: best height ${bestHeight} (${bestHashHex}) -> tip height ${tipHeight} (${tipHashHex})`);

    // 1. Reorganization check
    if (bestHeight > 0) {
      let currentLocalHeight = bestHeight;
      let currentLocalHashHex = bestHashHex;

      while (currentLocalHeight > 0) {
        const remoteHashHex = await this.fetchBlockHash(currentLocalHeight);
        if (remoteHashHex === currentLocalHashHex) {
          break;
        }
        this.logger?.warn(`Reorg detected at height ${currentLocalHeight}: local ${currentLocalHashHex} != remote ${remoteHashHex}`);
        currentLocalHeight--;
        if (currentLocalHeight > 0) {
          currentLocalHashHex = await this.fetchBlockHash(currentLocalHeight);
        } else {
          currentLocalHashHex = "";
        }
      }

      if (currentLocalHeight < bestHeight) {
        this.logger?.warn(`Handling reorg: rolling back from height ${bestHeight} to common ancestor ${currentLocalHeight}`);

        const managerRelevant = confirmManager.get_relevant_txids();
        const monitorRelevant = confirmMonitor.get_relevant_txids();
        const allRelevantTxids = new Set<string>();

        for (const tuple of [...managerRelevant, ...monitorRelevant]) {
          allRelevantTxids.add(bytesToHex(tuple.get_a()));
        }

        // Notify unconfirmed for all relevant txs that were confirmed above the common ancestor
        for (const txidHex of allRelevantTxids) {
          const txid = hexToBytes(txidHex);
          confirmManager.transaction_unconfirmed(txid);
          confirmMonitor.transaction_unconfirmed(txid);
        }

        // Notify best block updated to the common ancestor
        const commonAncestorHeaderHex = await this.fetchBlockHeader(currentLocalHeight);
        const commonAncestorHeader = hexToBytes(commonAncestorHeaderHex);
        confirmManager.best_block_updated(commonAncestorHeader, currentLocalHeight);
        confirmMonitor.best_block_updated(commonAncestorHeader, currentLocalHeight);

        bestHeight = currentLocalHeight;
        bestHashHex = currentLocalHashHex;
      }
    }

    // 2. Sync forward block-by-block
    let currentHeight = bestHeight + 1;
    while (currentHeight <= tipHeight) {
      const blockHashHex = await this.fetchBlockHash(currentHeight);
      const blockHeaderHex = await this.fetchBlockHeader(currentHeight);
      const blockHeader = hexToBytes(blockHeaderHex);

      const txdata: TwoTuple_usizeTransactionZ[] = [];
      const activeTxidsToCheck = new Set<string>();

      // Load transactions LDK is monitoring
      const managerRelevant = confirmManager.get_relevant_txids();
      const monitorRelevant = confirmMonitor.get_relevant_txids();
      for (const tuple of [...managerRelevant, ...monitorRelevant]) {
        // If it was previously confirmed, check if it was at or after currentHeight
        // Or if it needs confirmation check
        activeTxidsToCheck.add(bytesToHex(tuple.get_a()));
      }

      // Add manually registered transactions (e.g. funding transactions)
      for (const txidHex of this.registeredTxs.keys()) {
        activeTxidsToCheck.add(txidHex);
      }

      // Check registered outputs for spends
      for (const [outpointHex, watchedOutput] of this.registeredOutputs.entries()) {
        const [txidHex, indexStr] = outpointHex.split(":");
        const index = parseInt(indexStr, 10);
        const spendInfo = await this.fetchSpendInfo(txidHex, index);
        if (spendInfo && spendInfo.spent && spendInfo.status?.confirmed) {
          if (spendInfo.status.block_height === currentHeight) {
            if (spendInfo.txid) {
              activeTxidsToCheck.add(spendInfo.txid);
            }
          }
        }
      }

      // Query Esplora for each txid's confirmation status in the current block
      for (const txidHex of activeTxidsToCheck) {
        const tx = await this.fetchTx(txidHex);
        if (tx && tx.status?.confirmed && tx.status.block_height === currentHeight) {
          const rawTxHex = await this.fetchRawTx(txidHex);
          const rawTx = hexToBytes(rawTxHex);
          const merkle = await this.fetchMerkleProof(txidHex);
          const index = merkle ? merkle.pos : 0;
          txdata.push(TwoTuple_usizeTransactionZ.constructor_new(index, rawTx));
        }
      }

      // Sort by position (chain order)
      txdata.sort((a, b) => a.get_a() - b.get_a());

      // Notify confirmations
      if (txdata.length > 0) {
        confirmManager.transactions_confirmed(blockHeader, txdata, currentHeight);
        confirmMonitor.transactions_confirmed(blockHeader, txdata, currentHeight);
      }

      // Update best block
      confirmManager.best_block_updated(blockHeader, currentHeight);
      confirmMonitor.best_block_updated(blockHeader, currentHeight);

      currentHeight++;
    }
  }
}
