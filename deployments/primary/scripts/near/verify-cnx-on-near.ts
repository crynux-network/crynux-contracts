import { primaryRuntime } from '../common.js';
import {
  formatCnxAmount,
  getConfiguredNearDeployerAccountId,
  getNearCrynuxTokenAccountId,
  getNearTokenBalance,
  viewNearFunction,
} from './common.js';

type FungibleTokenMetadata = {
  spec: string;
  name: string;
  symbol: string;
  decimals: number;
};

function getRecipientAccountId(): string {
  if (primaryRuntime.optionArgs.length > 0) {
    throw new Error(`Unsupported option: ${primaryRuntime.optionArgs[0]}.`);
  }

  if (primaryRuntime.positionalArgs.length > 1) {
    throw new Error('Usage: npx tsx deployments/primary/scripts/near/verify-cnx-on-near.ts [near-recipient-account-id] --network=<testnet|mainnet>');
  }

  const [recipientAccountId] = primaryRuntime.positionalArgs as [string?];

  if (recipientAccountId === undefined) {
    return getConfiguredNearDeployerAccountId();
  }

  if (!/^[a-z0-9._-]+$/.test(recipientAccountId)) {
    throw new Error('The NEAR recipient account ID contains unsupported characters.');
  }

  return recipientAccountId;
}

const recipientAccountId = getRecipientAccountId();
const tokenAccountId = getNearCrynuxTokenAccountId();
const metadata = await viewNearFunction<FungibleTokenMetadata>(tokenAccountId, 'ft_metadata', {});
const balance = await getNearTokenBalance(tokenAccountId, recipientAccountId);

console.log(`${primaryRuntime.names.near} CNX token account: ${tokenAccountId}`);
console.log('Token metadata:');
console.log(JSON.stringify(metadata, null, 2));
console.log(`${recipientAccountId} balance: ${formatCnxAmount(balance)} CNX`);
