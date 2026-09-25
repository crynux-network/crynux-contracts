import { readFile } from 'node:fs/promises';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { Erc20Bridger, type ArbitrumNetwork } from '@arbitrum/sdk';
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
} from 'viem';
import { mainnet as ethereumMainnet, sepolia as ethereumSepolia } from 'viem/chains';
import {
  type ConfiguredArbitrumNetwork,
  registerConfiguredArbitrumNetwork,
  resolveAndValidateTokenBinding,
} from '../lib/arbitrum/network.js';
import {
  assertAddress,
  getConfiguredDeployerPrivateKey,
  getConfiguredRpcUrl,
  getPrimaryDeployerAccount,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../common.js';
import { ethereumContracts } from '../ethereum/common.js';

export type RobinhoodConfig = Omit<ConfiguredArbitrumNetwork, 'isTestnet'> & {
  rpcUrl: string;
};

export type RobinhoodContracts = {
  robinhoodCrynuxTokenAddress: Address | '';
  benefitAddress: Address | '';
  resolvedAtBlockNumber: number;
  benefitAddressDeployedAtBlockNumber: number;
};

const configFile = getPrimaryLayerFile('robinhood', 'config.json');
const contractsFile = getPrimaryLayerFile('robinhood', 'contracts.json');

export const robinhoodConfig = JSON.parse(await readFile(configFile, 'utf8')) as RobinhoodConfig;
export const robinhoodContracts = JSON.parse(await readFile(contractsFile, 'utf8')) as RobinhoodContracts;
export const ethereumChain = primaryRuntime.isTestnet ? ethereumSepolia : ethereumMainnet;
export const ethereumRpcUrl = await getConfiguredRpcUrl(
  primaryRuntime.hardhatNetworks.ethereum,
  primaryRuntime.names.ethereum,
);
export const robinhoodRpcUrl = await getConfiguredRpcUrl(
  primaryRuntime.hardhatNetworks.robinhood,
  primaryRuntime.names.robinhood,
);
export const robinhoodChain = defineChain({
  id: robinhoodConfig.chainId,
  name: robinhoodConfig.name,
  network: primaryRuntime.isTestnet ? 'robinhood-chain-testnet' : 'robinhood-chain',
  nativeCurrency: {
    name: primaryRuntime.isTestnet ? 'Sepolia Ether' : 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [robinhoodRpcUrl] },
    public: { http: [robinhoodRpcUrl] },
  },
});

export const ethereumPublicClient = createPublicClient({
  chain: ethereumChain,
  transport: http(ethereumRpcUrl),
});
export const robinhoodPublicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(robinhoodRpcUrl),
});

export function createEthereumProvider(): JsonRpcProvider {
  return new JsonRpcProvider(ethereumRpcUrl);
}

export function createRobinhoodProvider(): JsonRpcProvider {
  return new JsonRpcProvider(robinhoodRpcUrl);
}

export async function getEthereumSigner(): Promise<Wallet> {
  return new Wallet(await getConfiguredDeployerPrivateKey(), createEthereumProvider());
}

export async function getRobinhoodSigner(): Promise<Wallet> {
  return new Wallet(await getConfiguredDeployerPrivateKey(), createRobinhoodProvider());
}

export function getEthereumCrynuxTokenAddress(): Address {
  return assertAddress(ethereumContracts.crynuxTokenAddress, 'ethereum.contracts.crynuxTokenAddress');
}

export function getRobinhoodCrynuxTokenAddress(): Address {
  return assertAddress(
    robinhoodContracts.robinhoodCrynuxTokenAddress,
    'robinhood.contracts.robinhoodCrynuxTokenAddress',
  );
}

export async function registerRobinhoodNetwork(): Promise<{
  network: ArbitrumNetwork;
  parentProvider: JsonRpcProvider;
  childProvider: JsonRpcProvider;
}> {
  const parentProvider = createEthereumProvider();
  const childProvider = createRobinhoodProvider();
  const network = await registerConfiguredArbitrumNetwork(
    {
      ...robinhoodConfig,
      isTestnet: primaryRuntime.isTestnet,
    },
    parentProvider,
    childProvider,
    ethereumPublicClient,
  );

  return { network, parentProvider, childProvider };
}

export async function getValidatedCrynuxTokenBinding(): Promise<{
  bridger: Erc20Bridger;
  ethereumCrynuxTokenAddress: Address;
  robinhoodCrynuxTokenAddress: Address;
  parentProvider: JsonRpcProvider;
  childProvider: JsonRpcProvider;
}> {
  const { network, parentProvider, childProvider } = await registerRobinhoodNetwork();
  const bridger = new Erc20Bridger(network);
  const ethereumCrynuxTokenAddress = getEthereumCrynuxTokenAddress();
  const robinhoodCrynuxTokenAddress = getRobinhoodCrynuxTokenAddress();

  await resolveAndValidateTokenBinding(
    bridger,
    ethereumCrynuxTokenAddress,
    parentProvider,
    childProvider,
    robinhoodCrynuxTokenAddress,
  );

  return {
    bridger,
    ethereumCrynuxTokenAddress,
    robinhoodCrynuxTokenAddress,
    parentProvider,
    childProvider,
  };
}

export async function getCrynuxTokenBindingForDeposit(): Promise<{
  bridger: Erc20Bridger;
  ethereumCrynuxTokenAddress: Address;
  robinhoodCrynuxTokenAddress: Address;
  parentProvider: JsonRpcProvider;
  childProvider: JsonRpcProvider;
}> {
  const { network, parentProvider, childProvider } = await registerRobinhoodNetwork();
  const bridger = new Erc20Bridger(network);
  const ethereumCrynuxTokenAddress = getEthereumCrynuxTokenAddress();
  const expectedRobinhoodTokenAddress = robinhoodContracts.robinhoodCrynuxTokenAddress === ''
    ? undefined
    : assertAddress(
      robinhoodContracts.robinhoodCrynuxTokenAddress,
      'robinhood.contracts.robinhoodCrynuxTokenAddress',
    );
  const robinhoodCrynuxTokenAddress = await resolveAndValidateTokenBinding(
    bridger,
    ethereumCrynuxTokenAddress,
    parentProvider,
    childProvider,
    expectedRobinhoodTokenAddress,
    false,
  );

  return {
    bridger,
    ethereumCrynuxTokenAddress,
    robinhoodCrynuxTokenAddress,
    parentProvider,
    childProvider,
  };
}

export { getConfiguredDeployerPrivateKey, getPrimaryDeployerAccount, assertAddress };
