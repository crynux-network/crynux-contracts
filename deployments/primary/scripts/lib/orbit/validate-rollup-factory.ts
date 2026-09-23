import { getRollupCreatorAddress } from '@arbitrum/chain-sdk/utils';
import { isAddress, parseAbi, zeroAddress, type Address } from 'viem';
import { orbitRuntime, parentChainPublicClient } from './runtime.js';

const rollupCreatorTemplateAbi = parseAbi([
  'function bridgeCreator() view returns (address)',
  'function challengeManagerTemplate() view returns (address)',
  'function l2FactoriesDeployer() view returns (address)',
  'function osp() view returns (address)',
  'function rollupAdminLogic() view returns (address)',
  'function rollupUserLogic() view returns (address)',
  'function upgradeExecutorLogic() view returns (address)',
  'function validatorWalletCreator() view returns (address)',
]);

const templateFunctions = [
  'bridgeCreator',
  'challengeManagerTemplate',
  'l2FactoriesDeployer',
  'osp',
  'rollupAdminLogic',
  'rollupUserLogic',
  'upgradeExecutorLogic',
  'validatorWalletCreator',
] as const;

async function requireContract(address: Address, description: string): Promise<void> {
  const bytecode = await parentChainPublicClient.getBytecode({ address });
  if (bytecode === undefined || bytecode === '0x') {
    throw new Error(`${description} ${address} has no deployed bytecode on ${orbitRuntime.parentName}.`);
  }
}

export async function validateRollupCreatorV32(): Promise<Address> {
  const rollupCreator = getRollupCreatorAddress(parentChainPublicClient, 'v3.2');
  await requireContract(rollupCreator, 'RollupCreator v3.2');

  for (const functionName of templateFunctions) {
    const templateAddress = await parentChainPublicClient.readContract({
      address: rollupCreator,
      abi: rollupCreatorTemplateAbi,
      functionName,
    });

    if (!isAddress(templateAddress) || templateAddress === zeroAddress) {
      throw new Error(`RollupCreator v3.2 ${functionName} returned an invalid address: ${templateAddress}.`);
    }
    await requireContract(templateAddress, `RollupCreator v3.2 ${functionName}`);
  }

  console.log(`Validated RollupCreator v3.2 and current templates at ${rollupCreator}.`);
  return rollupCreator;
}
