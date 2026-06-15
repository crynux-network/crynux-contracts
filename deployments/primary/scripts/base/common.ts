import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, mainnet as ethereumMainnet, sepolia as ethereumSepolia } from 'viem/chains';
import {
  assertAddress,
  getConfiguredDeployerPrivateKey,
  getConfiguredRpcUrl,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../common.js';
import { ethereumContracts } from '../ethereum/common.js';

export type BaseConfig = {
  networkContracts: {
    l1StandardBridgeOnEthereum: Address;
    l2StandardBridge: Address;
    optimismMintableERC20Factory: Address;
  };
  bridgedCrynuxToken: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

export type BaseContracts = {
  baseCrynuxTokenAddress: Address | '';
  benefitAddress: Address | '';
  createdAtBlockNumber: number;
  benefitAddressDeployedAtBlockNumber: number;
};

const baseChain = primaryRuntime.isTestnet ? baseSepolia : base;
const ethereumChain = primaryRuntime.isTestnet ? ethereumSepolia : ethereumMainnet;
const configFile = getPrimaryLayerFile('base', 'config.json');
const contractsFile = getPrimaryLayerFile('base', 'contracts.json');

const baseConfig = JSON.parse(await readFile(configFile, 'utf8')) as BaseConfig;

export const baseNetworkContracts = baseConfig.networkContracts;
export const bridgedCrynuxToken = baseConfig.bridgedCrynuxToken;
export const baseContracts = JSON.parse(await readFile(contractsFile, 'utf8')) as BaseContracts;
export { assertAddress };
export const baseRpcUrl = await getConfiguredRpcUrl(primaryRuntime.hardhatNetworks.base, primaryRuntime.names.base);
export const ethereumRpcUrl = await getConfiguredRpcUrl(
  primaryRuntime.hardhatNetworks.ethereum,
  primaryRuntime.names.ethereum,
);
export const basePublicClient = createPublicClient({
  chain: baseChain,
  transport: http(baseRpcUrl),
});
export const ethereumPublicClient = createPublicClient({
  chain: ethereumChain,
  transport: http(ethereumRpcUrl),
});

export async function getBaseDeployerWalletClient() {
  const account = privateKeyToAccount(await getConfiguredDeployerPrivateKey());

  return createWalletClient({
    account,
    chain: baseChain,
    transport: http(baseRpcUrl),
  });
}

export async function getEthereumDeployerWalletClient() {
  const account = privateKeyToAccount(await getConfiguredDeployerPrivateKey());

  return createWalletClient({
    account,
    chain: ethereumChain,
    transport: http(ethereumRpcUrl),
  });
}

export function getEthereumCrynuxTokenAddress(): Address {
  return assertAddress(ethereumContracts.crynuxTokenAddress, 'ethereum.contracts.crynuxTokenAddress');
}

export function getBaseCrynuxTokenAddress(): Address {
  return assertAddress(baseContracts.baseCrynuxTokenAddress, 'base.contracts.baseCrynuxTokenAddress');
}
