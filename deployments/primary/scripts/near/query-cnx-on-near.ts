import { formatUnits } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import {
  getNearCrynuxTokenAccountId,
  viewNearFunction,
} from './common.js';

type FungibleTokenMetadata = {
  spec: string;
  name: string;
  symbol: string;
  icon: string | null;
  reference: string | null;
  reference_hash: string | null;
  decimals: number;
};

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/near/query-cnx-on-near.ts');

const tokenAccountId = getNearCrynuxTokenAccountId();
const metadata = await viewNearFunction<FungibleTokenMetadata>(tokenAccountId, 'ft_metadata', {});
const totalSupply = await viewNearFunction<string>(tokenAccountId, 'ft_total_supply', {});
const formattedTotalSupply = formatUnits(BigInt(totalSupply), metadata.decimals);

console.log('NEAR CNX Token');
console.log(`Network: ${primaryRuntime.names.near}`);
console.log(`Token account: ${tokenAccountId}`);
console.log('');

console.log('Metadata');
console.log(`Name: ${metadata.name}`);
console.log(`Symbol: ${metadata.symbol}`);
console.log(`Decimals: ${metadata.decimals}`);
console.log(`Standard: ${metadata.spec}`);
console.log(`Icon: ${metadata.icon === null || metadata.icon === '' ? 'not set' : metadata.icon}`);
console.log(`Reference: ${metadata.reference === null || metadata.reference === '' ? 'not set' : metadata.reference}`);
console.log('');

console.log('Supply');
console.log(`Total supply: ${formattedTotalSupply} ${metadata.symbol}`);
console.log(`Raw total supply: ${totalSupply}`);
