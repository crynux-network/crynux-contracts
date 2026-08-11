import { writeFile } from 'node:fs/promises';
import { RLP, type NestedUint8Array } from '@ethereumjs/rlp';
import { createMerkleProof, createMPT, verifyMPTWithMerkleProof } from '@ethereumjs/mpt';
import { ChainKind, getAddress, type NearUnsignedTransaction, type OmniAddress } from '@omni-bridge/core';
import type { EvmProof } from '@omni-bridge/evm';
import { ProofKind } from '@omni-bridge/near';
import { formatUnits, numberToHex, type Hex } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import {
  ethereumPublicClient,
  ethereumRpcUrl,
  ethereumBridgeBuilder,
  getNearAccountBalance,
  getConfiguredNearDeployerAccountId,
  getEthereumCrynuxTokenAddress,
  getEthereumCrynuxTokenOmniAddress,
  getNearContractsFile,
  nearBridgeBuilder,
  nearContracts,
  nearNetworkContracts,
  omniBridge,
  sendEthereumBridgeTransaction,
  sendNearBridgeTransaction,
  sendNearTransaction,
  viewNearFunction,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/near/create-bridged-token.ts');

const ethereumFinalityRetryMs = 30_000;
const deployTokenDepositYocto = 5_000_000_000_000_000_000_000_000n;
const deployTokenGasBalanceBufferYocto = 50_000_000_000_000_000_000_000n;
const verifyProofGas = 30_000_000_000_000n;

type RpcLog = {
  address: Hex;
  topics: Hex[];
  data: Hex;
};

type RpcReceipt = {
  status?: Hex;
  root?: Hex;
  cumulativeGasUsed: Hex;
  logsBloom: Hex;
  logs: RpcLog[];
  type?: string;
  transactionIndex: Hex;
};

type RpcBlockHeader = {
  parentHash: Hex;
  sha3Uncles: Hex;
  miner: Hex;
  stateRoot: Hex;
  transactionsRoot: Hex;
  receiptsRoot: Hex;
  logsBloom: Hex;
  difficulty: Hex;
  number: Hex;
  gasLimit: Hex;
  gasUsed: Hex;
  timestamp: Hex;
  extraData: Hex;
  mixHash: Hex;
  nonce: Hex;
  baseFeePerGas?: Hex;
  withdrawalsRoot?: Hex;
  blobGasUsed?: Hex;
  excessBlobGas?: Hex;
  parentBeaconBlockRoot?: Hex;
  requestsHash?: Hex;
};

function logStage(message: string): void {
  console.log(`[create-bridged-token] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function encodeBorshBytes(value: Uint8Array): Uint8Array {
  const encoded = new Uint8Array(4 + value.length);
  new DataView(encoded.buffer).setUint32(0, value.length, true);
  encoded.set(value, 4);

  return encoded;
}

function assertRlpList(value: Uint8Array | NestedUint8Array, name: string): NestedUint8Array {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an RLP list.`);
  }

  return value;
}

function assertRlpBytes(value: Uint8Array | NestedUint8Array, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${name} must be RLP bytes.`);
  }

  return value;
}

async function ethereumRpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(ethereumRpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'crynux-primary-near-proof',
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`${primaryRuntime.names.ethereum} RPC ${method} failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as {
    error?: unknown;
    result?: T;
  };

  if (body.error !== undefined) {
    throw new Error(`${primaryRuntime.names.ethereum} RPC ${method} returned an error: ${JSON.stringify(body.error)}`);
  }

  if (body.result === undefined) {
    throw new Error(`${primaryRuntime.names.ethereum} RPC ${method} returned an unexpected response: ${JSON.stringify(body)}`);
  }

  return body.result;
}

function getReceiptTypeNumber(type: string | undefined): number {
  switch (type) {
    case 'legacy':
    case '0x0':
    case undefined:
      return 0;
    case 'eip2930':
    case '0x1':
      return 1;
    case 'eip1559':
    case '0x2':
      return 2;
    case 'eip4844':
    case '0x3':
      return 3;
    case 'eip7702':
    case 'eip-7702':
    case 'setCode':
    case '0x4':
      return 4;
    default:
      throw new Error(`Unsupported Ethereum receipt type: ${type}`);
  }
}

function encodeReceipt(receipt: RpcReceipt): Uint8Array {
  const status = receipt.status ?? receipt.root;

  if (status === undefined) {
    throw new Error('Ethereum receipt does not contain status or state root.');
  }

  const receiptData = RLP.encode([
    status === '0x1' ? '0x1' : status === '0x0' ? '0x' : status,
    receipt.cumulativeGasUsed,
    receipt.logsBloom,
    receipt.logs.map((log) => [log.address, log.topics, log.data]),
  ]);
  const typeNumber = getReceiptTypeNumber(receipt.type);

  if (typeNumber === 0) {
    return receiptData;
  }

  return new Uint8Array([typeNumber, ...receiptData]);
}

function encodeLog(log: RpcLog): Uint8Array {
  return RLP.encode([log.address, log.topics, log.data]);
}

function encodeBlockHeader(header: RpcBlockHeader): Uint8Array {
  const items = [
    header.parentHash,
    header.sha3Uncles,
    header.miner,
    header.stateRoot,
    header.transactionsRoot,
    header.receiptsRoot,
    header.logsBloom,
    header.difficulty,
    header.number,
    header.gasLimit,
    header.gasUsed,
    header.timestamp,
    header.extraData,
    header.mixHash,
    header.nonce,
    header.baseFeePerGas,
    header.withdrawalsRoot,
    header.blobGasUsed,
    header.excessBlobGas,
    header.parentBeaconBlockRoot,
    header.requestsHash,
  ].filter((item): item is Hex => item !== undefined).map((item) => (item === '0x0' ? '0x' : item));

  return RLP.encode(items);
}

async function getEip7702AwareEvmProof(
  receipt: Awaited<ReturnType<typeof ethereumPublicClient.waitForTransactionReceipt>>,
  topic: Hex,
): Promise<EvmProof> {
  const blockNumberHex = numberToHex(receipt.blockNumber);
  const blockHeader = await ethereumRpcRequest<RpcBlockHeader>('eth_getBlockByNumber', [blockNumberHex, false]);
  const blockReceipts = await ethereumRpcRequest<RpcReceipt[]>('eth_getBlockReceipts', [blockNumberHex]);
  const transactionIndex = Number(receipt.transactionIndex);
  const rpcReceipt = blockReceipts[transactionIndex];

  if (rpcReceipt === undefined) {
    throw new Error(`Ethereum RPC did not return receipt index ${transactionIndex} for block ${receipt.blockNumber}.`);
  }

  const trie = await createMPT();

  for (let index = 0; index < blockReceipts.length; index += 1) {
    const blockReceipt = blockReceipts[index];

    if (blockReceipt === undefined) {
      throw new Error(`Ethereum RPC returned an empty receipt at index ${index}.`);
    }

    await trie.put(RLP.encode(index), encodeReceipt(blockReceipt));
  }

  const receiptKey = RLP.encode(transactionIndex);
  const logIndex = rpcReceipt.logs.findIndex((log) => log.topics[0] === topic);

  if (logIndex === -1) {
    throw new Error(`Ethereum receipt does not contain Omni Bridge log topic ${topic}.`);
  }

  return {
    log_index: BigInt(logIndex),
    log_entry_data: encodeLog(rpcReceipt.logs[logIndex]),
    receipt_index: BigInt(transactionIndex),
    receipt_data: encodeReceipt(rpcReceipt),
    header_data: encodeBlockHeader(blockHeader),
    proof: await createMerkleProof(trie, receiptKey),
  };
}

async function validateEvmProofLocally(
  proof: EvmProof,
  receipt: Awaited<ReturnType<typeof ethereumPublicClient.waitForTransactionReceipt>>,
): Promise<void> {
  const log = receipt.logs[Number(proof.log_index)];

  if (log === undefined) {
    throw new Error(`Generated proof references missing receipt log index ${proof.log_index}.`);
  }

  const expectedLogEntryData = RLP.encode([log.address, [...log.topics], log.data]);

  if (!bytesEqual(expectedLogEntryData, proof.log_entry_data)) {
    throw new Error('Generated proof log entry does not match the Ethereum transaction receipt.');
  }

  const header = assertRlpList(RLP.decode(proof.header_data), 'EVM block header');
  const receiptsRoot = assertRlpBytes(header[5], 'EVM block header receipts root');
  const provenReceipt = await verifyMPTWithMerkleProof(
    await createMPT(),
    receiptsRoot,
    RLP.encode(proof.receipt_index),
    proof.proof,
  );

  if (provenReceipt === null) {
    throw new Error('Generated proof does not prove an existing Ethereum receipt.');
  }

  if (!bytesEqual(provenReceipt, proof.receipt_data)) {
    throw new Error('Generated proof receipt does not match the receipt trie value.');
  }

  logStage(
    `Local EVM proof validation passed. ` +
    `Receipt index: ${proof.receipt_index}; log index: ${proof.log_index}.`,
  );
}

function parseProverEntry(entry: unknown): { chain: ChainKind; accountId: string } | undefined {
  if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[1] !== 'string') {
    return undefined;
  }

  const chain = entry[0];

  if (typeof chain === 'number') {
    return { chain, accountId: entry[1] };
  }

  if (typeof chain === 'string' && chain in ChainKind) {
    return { chain: ChainKind[chain as keyof typeof ChainKind], accountId: entry[1] };
  }

  return undefined;
}

async function getEthProverAccountId(): Promise<string> {
  const provers = await viewNearFunction<unknown[]>(nearNetworkContracts.nearBridgeAccountId, 'get_provers', {});

  for (const entry of provers) {
    const prover = parseProverEntry(entry);

    if (prover?.chain === ChainKind.Eth) {
      return prover.accountId;
    }
  }

  throw new Error(`${primaryRuntime.names.near} Omni Bridge does not expose an Ethereum prover account.`);
}

async function verifyEvmProofOnNear(proverArgs: Uint8Array): Promise<void> {
  const ethProverAccountId = await getEthProverAccountId();
  logStage(`Verifying the EVM proof on ${primaryRuntime.names.near} with ${ethProverAccountId}.`);

  const verifyProofTransaction: NearUnsignedTransaction = {
    type: 'near',
    signerId: getConfiguredNearDeployerAccountId(),
    receiverId: ethProverAccountId,
    actions: [{
      type: 'FunctionCall',
      methodName: 'verify_proof',
      args: encodeBorshBytes(proverArgs),
      gas: verifyProofGas,
      deposit: 0n,
    }],
  };
  const receipt = await sendNearTransaction(verifyProofTransaction);

  logStage(`${primaryRuntime.names.near} EVM proof verification succeeded: ${receipt.transaction.hash}.`);
}

async function assertDeployBalance(): Promise<void> {
  const accountId = getConfiguredNearDeployerAccountId();
  const balance = await getNearAccountBalance(accountId);
  const available = BigInt(balance.amount);
  const required = deployTokenDepositYocto + deployTokenGasBalanceBufferYocto;

  logStage(
    `${primaryRuntime.names.near} deployer available balance: ${formatUnits(available, 24)} NEAR. ` +
    `Required before deploy_token: at least ${formatUnits(required, 24)} NEAR.`,
  );

  if (available < required) {
    throw new Error(
      `${primaryRuntime.names.near} deployer ${accountId} does not have enough available balance for deploy_token. ` +
      `Available: ${formatUnits(available, 24)} NEAR; required: ${formatUnits(required, 24)} NEAR.`,
    );
  }
}

async function writeContracts(updatedContracts: typeof nearContracts): Promise<void> {
  await writeFile(getNearContractsFile(), `${JSON.stringify(updatedContracts, null, 2)}\n`);
}

function normalizeNearTokenAccountId(bridgedToken: OmniAddress): string {
  const tokenAccountId = getAddress(bridgedToken);

  if (!/^[a-z0-9._-]+$/.test(tokenAccountId)) {
    throw new Error(`Omni Bridge returned an invalid NEAR token account ID: ${bridgedToken}`);
  }

  return tokenAccountId;
}

async function recordIfTokenExists(
  metadataLoggedTransactionHash: string,
  createdAtTransactionHash = nearContracts.createdAtTransactionHash,
): Promise<boolean> {
  logStage(`Checking whether the NEAR bridged CNX token already exists for ${getEthereumCrynuxTokenOmniAddress()}.`);

  const bridgedToken = await omniBridge.getBridgedToken(getEthereumCrynuxTokenOmniAddress(), ChainKind.Near);

  if (bridgedToken === null) {
    logStage('The NEAR bridged CNX token does not exist yet.');
    return false;
  }

  const nearCrynuxTokenAccountId = normalizeNearTokenAccountId(bridgedToken);
  const updatedContracts = {
    ...nearContracts,
    nearCrynuxTokenAccountId,
    metadataLoggedTransactionHash,
    createdAtTransactionHash,
  };

  await writeContracts(updatedContracts);

  const metadata = await omniBridge.getTokenDecimals(bridgedToken);
  logStage(`The NEAR bridged CNX token exists at ${nearCrynuxTokenAccountId}.`);
  console.log(`${primaryRuntime.names.near} CNX token recorded:`);
  console.log(JSON.stringify({
    ...updatedContracts,
    metadata,
  }, null, 2));

  return true;
}

function getFirstBridgeLogTopic(receipt: Awaited<ReturnType<typeof ethereumPublicClient.waitForTransactionReceipt>>): Hex {
  const bridgeLog = receipt.logs.find((log) => log.address.toLowerCase() === ethereumBridgeBuilder.bridgeAddress.toLowerCase());
  const topic = bridgeLog?.topics[0];

  if (topic === undefined) {
    throw new Error('Metadata transaction did not emit an Omni Bridge log.');
  }

  logStage(`Found Omni Bridge metadata log topic ${topic}.`);

  return topic;
}

async function waitForEthereumFinality(
  receipt: Awaited<ReturnType<typeof ethereumPublicClient.waitForTransactionReceipt>>,
): Promise<void> {
  logStage(
    `Waiting for ${primaryRuntime.names.ethereum} metadata transaction ${receipt.transactionHash} ` +
    `in block ${receipt.blockNumber} to become finalized.`,
  );

  while (true) {
    const finalizedBlock = await ethereumPublicClient.getBlock({ blockTag: 'finalized' });

    if (finalizedBlock.number >= receipt.blockNumber) {
      logStage(
        `${primaryRuntime.names.ethereum} metadata transaction is finalized. ` +
        `Transaction block: ${receipt.blockNumber}; finalized block: ${finalizedBlock.number}.`,
      );
      return;
    }

    console.log(
      `${primaryRuntime.names.ethereum} metadata transaction ${receipt.transactionHash} is not finalized yet. ` +
      `Transaction block: ${receipt.blockNumber}; finalized block: ${finalizedBlock.number}. ` +
      `Retrying in ${ethereumFinalityRetryMs / 1000} seconds.`,
    );

    await sleep(ethereumFinalityRetryMs);
  }
}

async function deployNearTokenFromMetadataHash(metadataHash: Hex): Promise<string> {
  logStage(`Reading ${primaryRuntime.names.ethereum} metadata transaction receipt ${metadataHash}.`);

  const metadataReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash: metadataHash });
  logStage(
    `${primaryRuntime.names.ethereum} metadata transaction receipt found. ` +
    `Block: ${metadataReceipt.blockNumber}; status: ${metadataReceipt.status}.`,
  );

  await waitForEthereumFinality(metadataReceipt);

  logStage('Generating Omni Bridge EVM proof for the metadata log.');
  const metadataProof = await getEip7702AwareEvmProof(metadataReceipt, getFirstBridgeLogTopic(metadataReceipt));
  logStage(
    `Omni Bridge EVM proof generated. ` +
    `Receipt index: ${metadataProof.receipt_index}; log index: ${metadataProof.log_index}; proof nodes: ${metadataProof.proof.length}.`,
  );

  await validateEvmProofLocally(metadataProof, metadataReceipt);
  const proverArgs = nearBridgeBuilder.serializeEvmProofArgs({
    proof_kind: ProofKind.LogMetadata,
    proof: metadataProof,
  });
  await verifyEvmProofOnNear(proverArgs);
  await assertDeployBalance();

  logStage(
    `Building ${primaryRuntime.names.near} deploy_token transaction with attached deposit ${deployTokenDepositYocto} yoctoNEAR.`,
  );
  const deployTokenTransaction = nearBridgeBuilder.buildDeployToken(
    ChainKind.Eth,
    proverArgs,
    getConfiguredNearDeployerAccountId(),
    deployTokenDepositYocto,
  );
  logStage(`Submitting deploy_token transaction to ${primaryRuntime.names.near}.`);

  const deployReceipt = await sendNearBridgeTransaction(deployTokenTransaction);
  logStage(`${primaryRuntime.names.near} deploy_token transaction succeeded: ${deployReceipt.transaction.hash}.`);

  return deployReceipt.transaction.hash;
}

logStage(`Starting NEAR bridged CNX token creation for ${primaryRuntime.network}.`);
logStage(`Contracts file: ${getNearContractsFile()}.`);

if (nearContracts.nearCrynuxTokenAccountId !== '') {
  logStage(`${primaryRuntime.names.near} CNX token is already recorded. No transaction is needed.`);
  console.log(`${primaryRuntime.names.near} CNX token is already recorded. Skipping creation.`);
  console.log(JSON.stringify(nearContracts, null, 2));
  process.exit(0);
}

if (nearContracts.metadataLoggedTransactionHash !== '') {
  logStage(`Using recorded ${primaryRuntime.names.ethereum} metadata transaction ${nearContracts.metadataLoggedTransactionHash}.`);
  const recorded = await recordIfTokenExists(nearContracts.metadataLoggedTransactionHash);

  if (!recorded) {
    logStage('Recorded metadata exists, but the NEAR bridged token is not recorded yet. Deploying the token on NEAR.');
    const createdAtTransactionHash = await deployNearTokenFromMetadataHash(nearContracts.metadataLoggedTransactionHash as Hex);
    const deployed = await recordIfTokenExists(nearContracts.metadataLoggedTransactionHash, createdAtTransactionHash);

    if (!deployed) {
      throw new Error(`${primaryRuntime.names.near} CNX token was not found after deploy_token transaction ${createdAtTransactionHash}.`);
    }
  }

  process.exit(0);
}

const ethereumCrynuxTokenAddress = getEthereumCrynuxTokenAddress();
logStage(`No metadata transaction is recorded. Logging metadata for Ethereum CNX token ${ethereumCrynuxTokenAddress}.`);

const metadataHash = await sendEthereumBridgeTransaction(ethereumBridgeBuilder.buildLogMetadata(ethereumCrynuxTokenAddress));
logStage(`${primaryRuntime.names.ethereum} logMetadata transaction submitted: ${metadataHash}.`);

const metadataReceipt = await ethereumPublicClient.waitForTransactionReceipt({ hash: metadataHash });
logStage(
  `${primaryRuntime.names.ethereum} logMetadata transaction confirmed. ` +
  `Block: ${metadataReceipt.blockNumber}; status: ${metadataReceipt.status}.`,
);

const updatedContracts = {
  ...nearContracts,
  metadataLoggedTransactionHash: metadataHash,
};

await writeContracts(updatedContracts);
logStage(`Recorded metadata transaction hash in ${getNearContractsFile()}.`);

console.log(`${primaryRuntime.names.ethereum} Omni Bridge metadata logged:`);
console.log(JSON.stringify(metadataReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

const createdAtTransactionHash = await deployNearTokenFromMetadataHash(metadataHash);
const recorded = await recordIfTokenExists(metadataHash, createdAtTransactionHash);

if (!recorded) {
  throw new Error(`${primaryRuntime.names.near} CNX token was not found after deploy_token transaction ${createdAtTransactionHash}.`);
}
