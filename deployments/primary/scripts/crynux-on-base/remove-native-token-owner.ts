import { expectPositionalArgs } from '../common.js';
import { assertAddress, getDeployerAccount } from './common.js';
import {
  assertChainOwner,
  getAllNativeTokenOwners,
  isNativeTokenOwner,
  sendArbOwnerNativeTokenTransaction,
} from './native-token-owner.js';

const [ownerInput] = expectPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/crynux-on-base/remove-native-token-owner.ts <ownerAddress>',
);
const ownerAddress = assertAddress(ownerInput, 'ownerAddress');

const deployer = await getDeployerAccount();
await assertChainOwner(deployer.address);

if (!(await isNativeTokenOwner(ownerAddress))) {
  console.log(`${ownerAddress} is not a native token owner. Skipping transaction.`);
} else {
  await sendArbOwnerNativeTokenTransaction(deployer, 'removeNativeTokenOwner', [ownerAddress], 'Remove native token owner');

  const remainingOwners = await getAllNativeTokenOwners();
  console.log('Native token owners:', remainingOwners);

  if (remainingOwners.length === 0) {
    console.log('The native token owner list is empty. Value-bearing L2-to-L1 withdrawals are re-opened.');
  }
}
