import type { JsonRpcProvider } from '@ethersproject/providers';

export async function registerCrynuxOnBaseNetwork(parentChainProvider: JsonRpcProvider) {
  process.env.CRYNUX_ORBIT_TARGET = 'base';
  const { registerOrbitNetwork } = await import('../lib/orbit/bridge-network.js');
  return registerOrbitNetwork(parentChainProvider);
}
