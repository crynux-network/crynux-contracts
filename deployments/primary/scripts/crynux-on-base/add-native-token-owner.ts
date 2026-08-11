import { expectPositionalArgs } from '../common.js';
import { assertAddress, getDeployerAccount } from './common.js';
import {
  assertChainOwner,
  getAllNativeTokenOwners,
  getLatestBlockTimestamp,
  getNativeTokenManagementFrom,
  isNativeTokenOwner,
  sendArbOwnerNativeTokenTransaction,
} from './native-token-owner.js';

const nativeTokenManagementEnableDelaySeconds = BigInt(7 * 24 * 60 * 60 + 60 * 60);

const [ownerInput] = expectPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/crynux-on-base/add-native-token-owner.ts <ownerAddress>',
);
const ownerAddress = assertAddress(ownerInput, 'ownerAddress');

const deployer = await getDeployerAccount();
await assertChainOwner(deployer.address);

const managementFrom = await getNativeTokenManagementFrom();
const latestBlockTimestamp = await getLatestBlockTimestamp();

if (managementFrom === BigInt(0)) {
  const activationTimestamp = latestBlockTimestamp + nativeTokenManagementEnableDelaySeconds;

  await sendArbOwnerNativeTokenTransaction(
    deployer,
    'setNativeTokenManagementFrom',
    [activationTimestamp],
    'Enable native token management',
  );

  console.log(`Native token management activates at ${new Date(Number(activationTimestamp) * 1000).toISOString()}.`);
  console.log('Re-run this script after the activation time to add the native token owner.');
} else if (managementFrom > latestBlockTimestamp) {
  console.log(`Native token management activates at ${new Date(Number(managementFrom) * 1000).toISOString()}.`);
  console.log('Re-run this script after the activation time to add the native token owner.');
} else if (await isNativeTokenOwner(ownerAddress)) {
  console.log(`${ownerAddress} is already a native token owner. Skipping transaction.`);
} else {
  await sendArbOwnerNativeTokenTransaction(deployer, 'addNativeTokenOwner', [ownerAddress], 'Add native token owner');

  console.log('Native token owners:', await getAllNativeTokenOwners());
  console.log('Value-bearing L2-to-L1 withdrawals are blocked while at least one native token owner exists.');
}
