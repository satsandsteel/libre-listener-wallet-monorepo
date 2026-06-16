import { PhantomKeysManager, Recipient, Result_PublicKeyNoneZ_OK, ChannelManager, UserConfig, BestBlock, ChainParameters, Network, Option_FilterZ, Filter, Confirm } from "lightningdevkit";
import * as fs from "fs";
import * as path from "path";
import { initializeWasmFromBinary } from "lightningdevkit";

function loadWasmBinary(): Uint8Array {
  const p = path.resolve(__dirname, "../../../node_modules/lightningdevkit/liblightningjs.wasm");
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const p2 = path.resolve(__dirname, "../../../../node_modules/lightningdevkit/liblightningjs.wasm");
  if (fs.existsSync(p2)) return fs.readFileSync(p2);
  throw new Error("Could not find liblightningjs.wasm");
}

async function main() {
  await initializeWasmFromBinary(loadWasmBinary());
  const seed = new Uint8Array(32);
  const keysManager = PhantomKeysManager.constructor_new(
    seed,
    1000n,
    0,
    seed
  );
  
  const nodeRes = keysManager.as_NodeSigner().get_node_id(Recipient.LDKRecipient_Node);
  const phantomRes = keysManager.as_NodeSigner().get_node_id(Recipient.LDKRecipient_PhantomNode);
  
  console.log("Recipient_Node ID:", Buffer.from((nodeRes as Result_PublicKeyNoneZ_OK).res).toString("hex"));
  console.log("Recipient_PhantomNode ID:", Buffer.from((phantomRes as Result_PublicKeyNoneZ_OK).res).toString("hex"));

  // Mock services for ChannelManager
  const mockFeeEst = { get_est_sat_per_1000_weight: () => 253 };
  const mockBroadcaster = { broadcast_transactions: () => {} };
  const mockRouter = { find_route: () => {} };
  const mockMsgRouter = { get_route: () => {} };
  const mockLogger = { log: () => {} };
  
  const userConfig = UserConfig.constructor_default();
  const bestBlock = BestBlock.constructor_new(new Uint8Array(32), 0);
  const params = ChainParameters.constructor_new(Network.LDKNetwork_Regtest, bestBlock);
  
  const chanMan = ChannelManager.constructor_new(
    mockFeeEst as any,
    { watch_channel: () => {}, update_channel: () => {} } as any,
    mockBroadcaster as any,
    mockRouter as any,
    mockMsgRouter as any,
    mockLogger as any,
    keysManager.as_EntropySource(),
    keysManager.as_NodeSigner(),
    keysManager.as_SignerProvider(),
    userConfig,
    params,
    1000
  );

  console.log("ChannelManager get_our_node_id:", Buffer.from(chanMan.get_our_node_id()).toString("hex"));
}

main().catch(console.error);
