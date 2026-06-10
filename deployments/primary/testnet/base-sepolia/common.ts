import { readFile } from 'node:fs/promises';
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, sepolia as ethereumSepolia } from 'viem/chains';
import { assertAddress, getConfiguredDeployerPrivateKey } from '../../common.js';
import { ethereumContracts } from '../ethereum-sepolia/common.js';

export type BaseContracts = {
  baseCrynuxTokenAddress: Address | '';
  benefitAddress: Address | '';
  createdAtBlockNumber: number;
  benefitAddressDeployedAtBlockNumber: number;
};

export const baseNetworkContracts = {
  l1StandardBridgeOnEthereum: '0xfd0Bf71F60660E2f608ed56e1659C450eB113120',
  l2StandardBridge: '0x4200000000000000000000000000000000000010',
  optimismMintableERC20Factory: '0x4200000000000000000000000000000000000012',
} satisfies Record<string, Address>;
export const bridgedCrynuxToken = {
  name: 'Crynux Token',
  symbol: 'CNX',
  decimals: 18,
} as const;

export const baseContracts = JSON.parse(await readFile(new URL('./contracts.json', import.meta.url), 'utf8')) as BaseContracts;
export { assertAddress };
export const baseRpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? baseSepolia.rpcUrls.default.http[0];
export const ethereumRpcUrl = process.env.ETHEREUM_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
export const basePublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(baseRpcUrl),
});
export const ethereumPublicClient = createPublicClient({
  chain: ethereumSepolia,
  transport: http(ethereumRpcUrl),
});

export async function getBaseDeployerWalletClient() {
  const account = privateKeyToAccount(await getConfiguredDeployerPrivateKey());

  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(baseRpcUrl),
  });
}

export async function getEthereumDeployerWalletClient() {
  const account = privateKeyToAccount(await getConfiguredDeployerPrivateKey());

  return createWalletClient({
    account,
    chain: ethereumSepolia,
    transport: http(ethereumRpcUrl),
  });
}

export function getEthereumCrynuxTokenAddress(): Address {
  return assertAddress(ethereumContracts.crynuxTokenAddress, 'ethereum.contracts.crynuxTokenAddress');
}

export function getBaseCrynuxTokenAddress(): Address {
  return assertAddress(baseContracts.baseCrynuxTokenAddress, 'base.contracts.baseCrynuxTokenAddress');
}
