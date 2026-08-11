import { encodeFunctionData, type Address } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { orbitChain, orbitChainPublicClient } from './common.js';

export const arbOwnerAddress: Address = '0x0000000000000000000000000000000000000070';
export const arbOwnerPublicAddress: Address = '0x000000000000000000000000000000000000006b';

const arbOwnerNativeTokenAbi = [
  {
    type: 'function',
    name: 'setNativeTokenManagementFrom',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'timestamp', type: 'uint64' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'addNativeTokenOwner',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'removeNativeTokenOwner',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'ownerToRemove', type: 'address' }],
    outputs: [],
  },
] as const;

const arbOwnerPublicNativeTokenAbi = [
  {
    type: 'function',
    name: 'isChainOwner',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getNativeTokenManagementFrom',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint64' }],
  },
  {
    type: 'function',
    name: 'isNativeTokenOwner',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getAllNativeTokenOwners',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
] as const;

type ArbOwnerNativeTokenFunctionName = 'setNativeTokenManagementFrom' | 'addNativeTokenOwner' | 'removeNativeTokenOwner';

export async function assertChainOwner(address: Address): Promise<void> {
  const isChainOwner = await orbitChainPublicClient.readContract({
    address: arbOwnerPublicAddress,
    abi: arbOwnerPublicNativeTokenAbi,
    functionName: 'isChainOwner',
    args: [address],
  });

  if (!isChainOwner) {
    throw new Error(`Deployer ${address} is not a ${orbitChain.name} chain owner.`);
  }
}

export function getNativeTokenManagementFrom(): Promise<bigint> {
  return orbitChainPublicClient.readContract({
    address: arbOwnerPublicAddress,
    abi: arbOwnerPublicNativeTokenAbi,
    functionName: 'getNativeTokenManagementFrom',
  });
}

export function isNativeTokenOwner(address: Address): Promise<boolean> {
  return orbitChainPublicClient.readContract({
    address: arbOwnerPublicAddress,
    abi: arbOwnerPublicNativeTokenAbi,
    functionName: 'isNativeTokenOwner',
    args: [address],
  });
}

export function getAllNativeTokenOwners(): Promise<readonly Address[]> {
  return orbitChainPublicClient.readContract({
    address: arbOwnerPublicAddress,
    abi: arbOwnerPublicNativeTokenAbi,
    functionName: 'getAllNativeTokenOwners',
  });
}

export async function getLatestBlockTimestamp(): Promise<bigint> {
  const latestBlock = await orbitChainPublicClient.getBlock();
  return latestBlock.timestamp;
}

export async function sendArbOwnerNativeTokenTransaction(
  deployer: PrivateKeyAccount,
  functionName: ArbOwnerNativeTokenFunctionName,
  args: readonly [Address] | readonly [bigint],
  label: string,
): Promise<void> {
  const transactionRequest = await orbitChainPublicClient.prepareTransactionRequest({
    account: deployer.address,
    to: arbOwnerAddress,
    data: encodeFunctionData({
      abi: arbOwnerNativeTokenAbi,
      functionName,
      args,
    } as Parameters<typeof encodeFunctionData>[0]),
  });

  const hash = await orbitChainPublicClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction({
      ...transactionRequest,
      chainId: orbitChain.id,
    }),
  });
  const transactionReceipt = await orbitChainPublicClient.waitForTransactionReceipt({ hash });

  console.log(`${label} transaction receipt:`);
  console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}
