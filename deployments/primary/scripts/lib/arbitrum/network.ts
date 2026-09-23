import { createTokenBridgeFetchTokenBridgeContracts } from '@arbitrum/chain-sdk';
import {
  Erc20Bridger,
  getArbitrumNetworkInformationFromRollup,
  registerCustomArbitrumNetwork,
  type ArbitrumNetwork,
} from '@arbitrum/sdk';
import type { JsonRpcProvider } from '@ethersproject/providers';
import type { Address, PublicClient } from 'viem';

export type ConfiguredTokenBridge = {
  parentGatewayRouter: Address;
  parentErc20Gateway: Address;
  parentCustomGateway: Address;
  parentWethGateway: Address;
  parentWeth: Address;
  parentMultiCall?: Address;
  childGatewayRouter: Address;
  childErc20Gateway: Address;
  childCustomGateway: Address;
  childWethGateway: Address;
  childWeth: Address;
  childMultiCall: Address;
};

export type ConfiguredArbitrumNetwork = {
  name: string;
  chainId: number;
  parentChainId: number;
  isTestnet: boolean;
  ethBridge: {
    bridge: Address;
    inbox: Address;
    sequencerInbox: Address;
    outbox: Address;
    rollup: Address;
  };
  tokenBridge: ConfiguredTokenBridge;
};

function assertMatchingAddress(actual: string, expected: string, name: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${name} mismatch. Expected ${expected}, got ${actual}.`);
  }
}

export async function registerConfiguredArbitrumNetwork(
  config: ConfiguredArbitrumNetwork,
  parentProvider: JsonRpcProvider,
  childProvider: JsonRpcProvider,
  parentPublicClient: PublicClient,
): Promise<ArbitrumNetwork> {
  const [parentNetwork, childNetwork, networkInformation, discoveredTokenBridge] = await Promise.all([
    parentProvider.getNetwork(),
    childProvider.getNetwork(),
    getArbitrumNetworkInformationFromRollup(config.ethBridge.rollup, parentProvider),
    createTokenBridgeFetchTokenBridgeContracts({
      inbox: config.ethBridge.inbox,
      parentChainPublicClient: parentPublicClient,
    }),
  ]);

  if (parentNetwork.chainId !== config.parentChainId) {
    throw new Error(`Parent RPC chain ID mismatch. Expected ${config.parentChainId}, got ${parentNetwork.chainId}.`);
  }

  if (childNetwork.chainId !== config.chainId) {
    throw new Error(`Child RPC chain ID mismatch. Expected ${config.chainId}, got ${childNetwork.chainId}.`);
  }

  if (networkInformation.parentChainId !== config.parentChainId) {
    throw new Error(
      `Rollup parent chain ID mismatch. Expected ${config.parentChainId}, got ${networkInformation.parentChainId}.`,
    );
  }

  for (const key of ['bridge', 'inbox', 'sequencerInbox', 'outbox', 'rollup'] as const) {
    assertMatchingAddress(networkInformation.ethBridge[key], config.ethBridge[key], `ethBridge.${key}`);
  }

  if (
    networkInformation.nativeToken !== undefined
    && networkInformation.nativeToken !== '0x0000000000000000000000000000000000000000'
  ) {
    throw new Error(`Expected ETH as the native token, got ${networkInformation.nativeToken}.`);
  }

  const tokenBridge = {
    parentGatewayRouter: discoveredTokenBridge.parentChainContracts.router,
    parentErc20Gateway: discoveredTokenBridge.parentChainContracts.standardGateway,
    parentCustomGateway: discoveredTokenBridge.parentChainContracts.customGateway,
    parentWethGateway: discoveredTokenBridge.parentChainContracts.wethGateway,
    parentWeth: discoveredTokenBridge.parentChainContracts.weth,
    parentMultiCall: discoveredTokenBridge.parentChainContracts.multicall,
    childGatewayRouter: discoveredTokenBridge.orbitChainContracts.router,
    childErc20Gateway: discoveredTokenBridge.orbitChainContracts.standardGateway,
    childCustomGateway: discoveredTokenBridge.orbitChainContracts.customGateway,
    childWethGateway: discoveredTokenBridge.orbitChainContracts.wethGateway,
    childWeth: discoveredTokenBridge.orbitChainContracts.weth,
    childMultiCall: discoveredTokenBridge.orbitChainContracts.multicall,
  };

  for (const [key, expected] of Object.entries(config.tokenBridge)) {
    if (expected !== undefined) {
      assertMatchingAddress(tokenBridge[key as keyof typeof tokenBridge], expected, `tokenBridge.${key}`);
    }
  }

  return registerCustomArbitrumNetwork({
    name: config.name,
    chainId: config.chainId,
    parentChainId: config.parentChainId,
    confirmPeriodBlocks: networkInformation.confirmPeriodBlocks,
    ethBridge: networkInformation.ethBridge,
    tokenBridge,
    isCustom: true,
    isTestnet: config.isTestnet,
    nativeToken: networkInformation.nativeToken,
  });
}

export async function resolveAndValidateTokenBinding(
  bridger: Erc20Bridger,
  parentTokenAddress: Address,
  parentProvider: JsonRpcProvider,
  childProvider: JsonRpcProvider,
  expectedChildTokenAddress?: Address,
  requireDeployedToken = true,
): Promise<Address> {
  const childTokenAddress = await bridger.getChildErc20Address(parentTokenAddress, parentProvider) as Address;

  if (
    expectedChildTokenAddress !== undefined
    && childTokenAddress.toLowerCase() !== expectedChildTokenAddress.toLowerCase()
  ) {
    throw new Error(
      `Child token binding mismatch. Expected ${expectedChildTokenAddress}, got ${childTokenAddress}.`,
    );
  }

  const childTokenCode = await childProvider.getCode(childTokenAddress);
  if (childTokenCode === '0x') {
    if (requireDeployedToken) {
      throw new Error(`Resolved child token ${childTokenAddress} is not deployed.`);
    }
    return childTokenAddress;
  }

  const resolvedParentTokenAddress = await bridger.getParentErc20Address(childTokenAddress, childProvider);
  assertMatchingAddress(resolvedParentTokenAddress, parentTokenAddress, 'CNX parent token binding');

  return childTokenAddress;
}
