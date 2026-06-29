import { writeFile } from 'node:fs/promises';
import { ChainKind, getAddress, type OmniAddress } from '@omni-bridge/core';
import { getEvmProof } from '@omni-bridge/evm';
import { ProofKind } from '@omni-bridge/near';
import type { Hex } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import {
  ethereumPublicClient,
  ethereumRpcUrl,
  ethereumBridgeBuilder,
  getConfiguredNearDeployerAccountId,
  getEthereumCrynuxTokenAddress,
  getEthereumCrynuxTokenOmniAddress,
  getNearContractsFile,
  nearBridgeBuilder,
  nearContracts,
  omniBridge,
  sendEthereumBridgeTransaction,
  sendNearBridgeTransaction,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/near/create-bridged-token.ts');

const ethereumFinalityRetryMs = 30_000;
const deployTokenDepositYocto = 5_000_000_000_000_000_000_000_000n;

function logStage(message: string): void {
  console.log(`[create-bridged-token] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const metadataProof = await getEvmProof(
    metadataHash,
    getFirstBridgeLogTopic(metadataReceipt),
    ChainKind.Eth,
    primaryRuntime.network,
    ethereumRpcUrl,
  );
  logStage(
    `Omni Bridge EVM proof generated. ` +
    `Receipt index: ${metadataProof.receipt_index}; log index: ${metadataProof.log_index}; proof nodes: ${metadataProof.proof.length}.`,
  );

  logStage(
    `Building ${primaryRuntime.names.near} deploy_token transaction with attached deposit ${deployTokenDepositYocto} yoctoNEAR.`,
  );
  const deployTokenTransaction = nearBridgeBuilder.buildDeployToken(
    ChainKind.Eth,
    nearBridgeBuilder.serializeEvmProofArgs({
      proof_kind: ProofKind.LogMetadata,
      proof: metadataProof,
    }),
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
