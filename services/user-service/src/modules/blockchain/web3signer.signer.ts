import { ethers } from "ethers";

type JsonRpcSuccess<T> = { jsonrpc: "2.0"; id: number; result: T };
type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string };
};
type Web3SignerFetch = typeof fetch;

/**
 * Ethers signer backed by Web3Signer's execution-layer JSON-RPC API.
 *
 * The application still uses its Polygon RPC provider for reads, gas
 * estimation, nonce selection, and transaction broadcast. This class only
 * sends signing requests to Web3Signer, so it never receives a private key.
 */
export class Web3SignerSigner extends ethers.AbstractSigner {
  private requestId = 0;
  readonly address: string;

  constructor(
    private readonly rpcUrl: string,
    address: string,
    private readonly expectedChainId: number,
    provider: ethers.Provider,
    private readonly fetchImpl: Web3SignerFetch = fetch,
  ) {
    super(provider);
    this.address = ethers.getAddress(address);
  }

  connect(provider: null | ethers.Provider): Web3SignerSigner {
    if (!provider) throw new Error("Web3Signer requires a blockchain provider");
    return new Web3SignerSigner(
      this.rpcUrl,
      this.address,
      this.expectedChainId,
      provider,
      this.fetchImpl,
    );
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  /** Confirm that the configured, allowlisted signer is actually loaded. */
  async assertConfiguredAccount(): Promise<void> {
    const accounts = await this.rpc<string[]>("eth_accounts", []);
    const configured = this.address.toLowerCase();
    if (
      !accounts.some(
        (account) => ethers.getAddress(account).toLowerCase() === configured,
      )
    ) {
      throw new Error(
        `Web3Signer does not expose the configured relay address ${this.address}`,
      );
    }
  }

  async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
    const populated = await this.populateTransaction(tx);
    const signed = await this.rpc<string>("eth_signTransaction", [
      this.toRpcTransaction(populated),
    ]);
    if (!ethers.isHexString(signed)) {
      throw new Error("Web3Signer returned a non-hex signed transaction");
    }

    const parsed = ethers.Transaction.from(signed);
    if (!parsed.from || ethers.getAddress(parsed.from) !== this.address) {
      throw new Error(
        "Web3Signer returned a transaction signed by an unexpected address",
      );
    }
    if (parsed.chainId !== BigInt(this.expectedChainId)) {
      throw new Error(
        `Web3Signer returned a transaction for unexpected chain ${parsed.chainId}`,
      );
    }
    return signed;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const bytes =
      typeof message === "string" ? ethers.toUtf8Bytes(message) : message;
    const signature = await this.rpc<string>("eth_sign", [
      this.address,
      ethers.hexlify(bytes),
    ]);
    if (ethers.verifyMessage(bytes, signature) !== this.address) {
      throw new Error("Web3Signer returned an invalid message signature");
    }
    return signature;
  }

  async signTypedData(
    domain: ethers.TypedDataDomain,
    types: Record<string, Array<ethers.TypedDataField>>,
    value: Record<string, any>,
  ): Promise<string> {
    const payload = ethers.TypedDataEncoder.getPayload(domain, types, value);
    const signature = await this.rpc<string>("eth_signTypedData", [
      this.address,
      payload,
    ]);
    if (
      ethers.verifyTypedData(domain, types, value, signature) !== this.address
    ) {
      throw new Error("Web3Signer returned an invalid typed-data signature");
    }
    return signature;
  }

  private toRpcTransaction(
    tx: ethers.TransactionLike<string>,
  ): Record<string, unknown> {
    const request: Record<string, unknown> = { from: this.address };
    const quantity = (value: ethers.BigNumberish | null | undefined) =>
      value == null ? undefined : ethers.toQuantity(value);
    const add = (key: string, value: unknown) => {
      if (value != null) request[key] = value;
    };

    add("to", tx.to ?? null);
    add("data", tx.data ?? "0x");
    add("value", quantity(tx.value));
    add("nonce", quantity(tx.nonce));
    add("gas", quantity(tx.gasLimit));
    add("gasPrice", quantity(tx.gasPrice));
    add("maxPriorityFeePerGas", quantity(tx.maxPriorityFeePerGas));
    add("maxFeePerGas", quantity(tx.maxFeePerGas));
    add("chainId", quantity(tx.chainId));
    add("type", quantity(tx.type));
    if (tx.accessList) request.accessList = ethers.accessListify(tx.accessList);
    return request;
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const id = ++this.requestId;
    let response: Response;
    try {
      response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
    } catch (err) {
      throw new Error(
        `Web3Signer request failed for ${method}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Web3Signer returned HTTP ${response.status} for ${method}`,
      );
    }
    const payload = (await response.json()) as
      | JsonRpcSuccess<T>
      | JsonRpcFailure;
    if ("error" in payload) {
      throw new Error(
        `Web3Signer RPC ${method} failed (${payload.error.code}): ${payload.error.message}`,
      );
    }
    return payload.result;
  }
}
