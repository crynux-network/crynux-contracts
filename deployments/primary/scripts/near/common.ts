import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ChainKind, createBridge, type EvmUnsignedTransaction, type NearUnsignedTransaction, type Network, type OmniAddress } from '@omni-bridge/core';
import { createEvmBuilder } from '@omni-bridge/evm';
import { createNearBuilder, toNearKitTransaction } from '@omni-bridge/near';
import { Entry } from '@napi-rs/keyring';
import { createPublicClient, createWalletClient, formatUnits, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet as ethereumMainnet, sepolia as ethereumSepolia } from 'viem/chains';
import { Near, parseKey, type KeyPair, type KeyStore } from 'near-kit';
import {
  assertAddress,
  getConfiguredDeployerPrivateKey,
  getConfiguredRpcUrl,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../common.js';
import { ethereumContracts } from '../ethereum/common.js';

export type NearConfig = {
  deployerAccountId: string;
  networkContracts: {
    ethereumBridgeAddress: Address;
    nearBridgeAccountId: string;
    nearTokenDeployerAccountId: string;
    nearRpcUrl: string;
  };
  bridgedCrynuxToken: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

export type NearContracts = {
  nearCrynuxTokenAccountId: string;
  metadataLoggedTransactionHash: string;
  createdAtTransactionHash: string;
  createdAtBlockHeight: number;
};

type NearAccessKeyListResponse = {
  error?: unknown;
  result?: {
    keys: Array<{
      public_key: string;
    }>;
  };
};

const ethereumChain = primaryRuntime.isTestnet ? ethereumSepolia : ethereumMainnet;
const omniNetwork = primaryRuntime.network as Network;
const configFile = getPrimaryLayerFile('near', 'config.json');
const contractsFile = getPrimaryLayerFile('near', 'contracts.json');
const initialNearContracts: NearContracts = {
  nearCrynuxTokenAccountId: '',
  metadataLoggedTransactionHash: '',
  createdAtTransactionHash: '',
  createdAtBlockHeight: 0,
};

export const nearConfig = JSON.parse(await readFile(configFile, 'utf8')) as NearConfig;
export const nearContracts = await readNearContracts();
export const nearNetworkContracts = nearConfig.networkContracts;
export const bridgedCrynuxToken = nearConfig.bridgedCrynuxToken;
export const ethereumRpcUrl = await getConfiguredRpcUrl(
  primaryRuntime.hardhatNetworks.ethereum,
  primaryRuntime.names.ethereum,
);
export const ethereumPublicClient = createPublicClient({
  chain: ethereumChain,
  transport: http(ethereumRpcUrl),
});
export const omniBridge = createBridge({
  network: omniNetwork,
  rpcUrls: {
    [ChainKind.Near]: nearNetworkContracts.nearRpcUrl,
  },
});
export const ethereumBridgeBuilder = createEvmBuilder({
  network: omniNetwork,
  chain: ChainKind.Eth,
});
export const nearBridgeBuilder = createNearBuilder({
  network: omniNetwork,
  rpcUrl: nearNetworkContracts.nearRpcUrl,
});

if (nearNetworkContracts.ethereumBridgeAddress.toLowerCase() !== ethereumBridgeBuilder.bridgeAddress.toLowerCase()) {
  throw new Error(`${primaryRuntime.names.ethereum} Omni Bridge address in near config does not match the Omni Bridge SDK Ethereum address.`);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

class NearCliRsKeyStore implements KeyStore {
  async add(): Promise<void> {
    throw new Error('NEAR keys must be created or imported with near-cli-rs save-to-keychain.');
  }

  async get(accountId: string): Promise<KeyPair | null> {
    const publicKeys = await this.getAccountPublicKeys(accountId);
    const service = `near-${primaryRuntime.network}-${accountId}`;

    for (const publicKey of publicKeys) {
      const stored = new Entry(service, `${accountId}:${publicKey}`).getPassword();

      if (stored === undefined || stored === null || stored === '') {
        continue;
      }

      const keyData = JSON.parse(stored) as {
        public_key?: string;
        private_key?: string;
      };

      if (keyData.private_key === undefined) {
        throw new Error(`NEAR keychain credential for ${accountId} and ${publicKey} does not contain private_key.`);
      }

      if (keyData.public_key !== undefined && keyData.public_key !== publicKey) {
        throw new Error(`NEAR keychain credential public key mismatch for ${accountId}.`);
      }

      return parseKey(keyData.private_key);
    }

    return null;
  }

  async remove(): Promise<void> {
    throw new Error('NEAR keys must be removed with near-cli-rs.');
  }

  async list(): Promise<string[]> {
    return [];
  }

  private async getAccountPublicKeys(accountId: string): Promise<string[]> {
    const response = await fetch(nearNetworkContracts.nearRpcUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'crynux-primary-near-access-keys',
        method: 'query',
        params: {
          request_type: 'view_access_key_list',
          finality: 'final',
          account_id: accountId,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`NEAR RPC access key request failed: ${response.status} ${await response.text()}`);
    }

    const body = await response.json() as NearAccessKeyListResponse;

    if (body.error !== undefined) {
      throw new Error(`NEAR RPC returned an access key error: ${JSON.stringify(body.error)}`);
    }

    if (body.result === undefined) {
      throw new Error(`NEAR RPC returned an unexpected access key response: ${JSON.stringify(body)}`);
    }

    return body.result.keys.map((key) => key.public_key);
  }
}

async function readNearContracts(): Promise<NearContracts> {
  try {
    return JSON.parse(await readFile(contractsFile, 'utf8')) as NearContracts;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    await mkdir(dirname(contractsFile), { recursive: true });
    await writeFile(contractsFile, `${JSON.stringify(initialNearContracts, null, 2)}\n`);

    return initialNearContracts;
  }
}

export async function getEthereumDeployerWalletClient() {
  const account = privateKeyToAccount(await getConfiguredDeployerPrivateKey());

  return createWalletClient({
    account,
    chain: ethereumChain,
    transport: http(ethereumRpcUrl),
  });
}

export async function sendEthereumBridgeTransaction(transaction: EvmUnsignedTransaction) {
  const walletClient = await getEthereumDeployerWalletClient();
  return await walletClient.sendTransaction({
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  });
}

export function getNearClient(): Near {
  return new Near({
    network: primaryRuntime.network,
    rpcUrl: nearNetworkContracts.nearRpcUrl,
    keyStore: new NearCliRsKeyStore(),
    defaultSignerId: getConfiguredNearDeployerAccountId(),
    defaultWaitUntil: 'FINAL',
  });
}

type NearExecutionStatus = {
  Failure?: unknown;
  SuccessReceiptId?: string;
  SuccessValue?: string;
};

type NearExecutionOutcome = {
  executor_id: string;
  status: NearExecutionStatus;
  logs: string[];
};

type NearTransactionResult = {
  transaction: {
    hash: string;
  };
  transaction_outcome?: {
    id?: string;
    outcome: NearExecutionOutcome;
  };
  receipts_outcome?: Array<{
    id: string;
    outcome: NearExecutionOutcome;
  }>;
};

function formatNearFailure(failure: unknown): string {
  return JSON.stringify(failure, null, 2);
}

function assertNearTransactionSucceeded(result: NearTransactionResult): void {
  const failures: string[] = [];
  const transactionOutcome = result.transaction_outcome;
  const transactionFailure = transactionOutcome?.outcome.status.Failure;

  if (transactionOutcome !== undefined && transactionFailure !== undefined) {
    failures.push(
      [
        `Transaction outcome failed on ${transactionOutcome.outcome.executor_id}.`,
        `Failure: ${formatNearFailure(transactionFailure)}`,
        `Logs: ${JSON.stringify(transactionOutcome.outcome.logs)}`,
      ].join('\n'),
    );
  }

  for (const receiptOutcome of result.receipts_outcome ?? []) {
    const receiptFailure = receiptOutcome.outcome.status.Failure;

    if (receiptFailure === undefined) {
      continue;
    }

    failures.push(
      [
        `Receipt ${receiptOutcome.id} failed on ${receiptOutcome.outcome.executor_id}.`,
        `Failure: ${formatNearFailure(receiptFailure)}`,
        `Logs: ${JSON.stringify(receiptOutcome.outcome.logs)}`,
      ].join('\n'),
    );
  }

  if (failures.length > 0) {
    throw new Error(`NEAR transaction ${result.transaction.hash} contains failed execution outcome(s):\n${failures.join('\n\n')}`);
  }
}

export async function sendNearBridgeTransaction(transaction: NearUnsignedTransaction) {
  const result = await toNearKitTransaction(getNearClient(), transaction).send({ waitUntil: 'FINAL' }) as NearTransactionResult;
  assertNearTransactionSucceeded(result);

  return result;
}

export function getEthereumCrynuxTokenAddress(): Address {
  return assertAddress(ethereumContracts.crynuxTokenAddress, 'ethereum.contracts.crynuxTokenAddress');
}

export function getEthereumCrynuxTokenOmniAddress(): OmniAddress {
  return `eth:${getEthereumCrynuxTokenAddress()}`;
}

export function getNearCrynuxTokenAccountId(): string {
  if (nearContracts.nearCrynuxTokenAccountId === '') {
    throw new Error('near.contracts.nearCrynuxTokenAccountId must be recorded.');
  }

  return nearContracts.nearCrynuxTokenAccountId;
}

export function getConfiguredNearDeployerAccountId(): string {
  if (!/^[a-z0-9._-]+$/.test(nearConfig.deployerAccountId)) {
    throw new Error('near.config.deployerAccountId must be a valid NEAR account ID.');
  }

  return nearConfig.deployerAccountId;
}

export function getExpectedNearTokenAccountId(ethereumTokenAddress = getEthereumCrynuxTokenAddress()): string {
  return `${ethereumTokenAddress.slice(2).toLowerCase()}.${nearNetworkContracts.nearTokenDeployerAccountId}`;
}

export function getNearContractsFile(): string {
  return contractsFile;
}

export async function viewNearFunction<T>(
  accountId: string,
  methodName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
  const response = await fetch(nearNetworkContracts.nearRpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'crynux-primary-near',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: accountId,
        method_name: methodName,
        args_base64: argsBase64,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`NEAR RPC request failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as {
    error?: unknown;
    result?: {
      result: number[];
    };
  };

  if (body.error !== undefined) {
    throw new Error(`NEAR RPC returned an error: ${JSON.stringify(body.error)}`);
  }

  if (body.result === undefined) {
    throw new Error(`NEAR RPC returned an unexpected response: ${JSON.stringify(body)}`);
  }

  return JSON.parse(Buffer.from(body.result.result).toString('utf8')) as T;
}

export async function tryViewNearFunction<T>(
  accountId: string,
  methodName: string,
  args: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    return await viewNearFunction<T>(accountId, methodName, args);
  } catch {
    return undefined;
  }
}

export async function getNearTokenBalance(tokenAccountId: string, ownerAccountId: string): Promise<bigint> {
  const balance = await viewNearFunction<string>(tokenAccountId, 'ft_balance_of', {
    account_id: ownerAccountId,
  });

  return BigInt(balance);
}

export function formatCnxAmount(value: bigint): string {
  return formatUnits(value, bridgedCrynuxToken.decimals);
}
