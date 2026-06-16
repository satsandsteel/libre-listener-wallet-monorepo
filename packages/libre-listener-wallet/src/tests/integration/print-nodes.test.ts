import { PhantomKeysManager, Recipient, Result_PublicKeyNoneZ_OK } from "lightningdevkit";
import * as fs from "fs";
import * as path from "path";
import { initializeWasmFromBinary } from "lightningdevkit";
import { describe, it, expect } from "vitest";

function loadWasmBinary(): Uint8Array {
  const p = path.resolve(__dirname, "../../../node_modules/lightningdevkit/liblightningjs.wasm");
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const p2 = path.resolve(__dirname, "../../../../node_modules/lightningdevkit/liblightningjs.wasm");
  if (fs.existsSync(p2)) return fs.readFileSync(p2);
  throw new Error("Could not find liblightningjs.wasm");
}

describe("print nodes", () => {
  it("prints keys", async () => {
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
    
    const nodePubkey = Buffer.from((nodeRes as Result_PublicKeyNoneZ_OK).res).toString("hex");
    const phantomPubkey = Buffer.from((phantomRes as Result_PublicKeyNoneZ_OK).res).toString("hex");

    console.log("Recipient_Node ID:", nodePubkey);
    console.log("Recipient_PhantomNode ID:", phantomPubkey);

    expect(nodePubkey).toBeDefined();
    expect(phantomPubkey).toBeDefined();
  });
});

