import { formatUnits } from 'viem';
import { primaryRuntime } from '../common.js';
import {
  getConfiguredNearDeployerAccountId,
  nearNetworkContracts,
} from './common.js';

type NearAccountViewResponse = {
  error?: unknown;
  result?: NearAccountBalance;
};

type NearAccountBalance = {
  amount: string;
  locked: string;
  storage_usage: number;
};

function getAccountId(): string {
  if (primaryRuntime.optionArgs.length > 0) {
    throw new Error(`Unsupported option: ${primaryRuntime.optionArgs[0]}.`);
  }

  if (primaryRuntime.positionalArgs.length > 1) {
    throw new Error('Usage: npx tsx deployments/primary/scripts/near/query-near-balance.ts [near-account-id] --network=<testnet|mainnet>');
  }

  const accountId = primaryRuntime.positionalArgs[0] ?? getConfiguredNearDeployerAccountId();

  if (!/^[a-z0-9._-]+$/.test(accountId)) {
    throw new Error('The NEAR account ID contains unsupported characters.');
  }

  return accountId;
}

async function getNearAccountBalance(accountId: string): Promise<NearAccountBalance> {
  const response = await fetch(nearNetworkContracts.nearRpcUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'crynux-primary-near-account-balance',
      method: 'query',
      params: {
        request_type: 'view_account',
        finality: 'final',
        account_id: accountId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`NEAR RPC account request failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json() as NearAccountViewResponse;

  if (body.error !== undefined) {
    throw new Error(`NEAR RPC returned an account error: ${JSON.stringify(body.error)}`);
  }

  if (body.result === undefined) {
    throw new Error(`NEAR RPC returned an unexpected account response: ${JSON.stringify(body)}`);
  }

  return body.result;
}

const accountId = getAccountId();
const balance = await getNearAccountBalance(accountId);
const availableAmount = BigInt(balance.amount);
const lockedAmount = BigInt(balance.locked);
const totalAmount = availableAmount + lockedAmount;

console.log('NEAR Account Balance');
console.log(`Network: ${primaryRuntime.names.near}`);
console.log(`Account: ${accountId}`);
console.log(`Available balance: ${formatUnits(availableAmount, 24)} NEAR`);
console.log(`Locked balance: ${formatUnits(lockedAmount, 24)} NEAR`);
console.log(`Total balance: ${formatUnits(totalAmount, 24)} NEAR`);
console.log(`Raw available balance: ${balance.amount}`);
console.log(`Raw locked balance: ${balance.locked}`);
console.log(`Storage usage: ${balance.storage_usage} bytes`);
