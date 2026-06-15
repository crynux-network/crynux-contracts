import { prepareKeysetHash, setValidKeysetPrepareTransactionRequest } from '@arbitrum/chain-sdk';
import { parseAbi } from 'viem';
import { expectPositionalArgs } from '../common.js';
import { getDacCoreContracts, getDacKeyset, getDeployerAccount, parentChainPublicClient } from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/crynux-on-base/set-dac-keyset.ts');

const sequencerInboxDacAbi = parseAbi([
  'error NoSuchKeyset(bytes32 keysetHash)',
  'function isValidKeysetHash(bytes32 ksHash) view returns (bool)',
  'function dasKeySetInfo(bytes32 ksHash) view returns (bool isValidKeyset, uint64 creationBlock)',
  'function getKeysetCreationBlock(bytes32 ksHash) view returns (uint256)',
]);

const coreContracts = getDacCoreContracts();

async function printDacKeysetState(keysetHash: `0x${string}`) {
  const isValidKeysetHash = await parentChainPublicClient.readContract({
    address: coreContracts.sequencerInbox,
    abi: sequencerInboxDacAbi,
    functionName: 'isValidKeysetHash',
    args: [keysetHash],
  });

  if (!isValidKeysetHash) {
    console.log('DAC keyset contract state:');
    console.log(
      JSON.stringify(
        {
          sequencerInbox: coreContracts.sequencerInbox,
          keysetHash,
          isValidKeysetHash,
        },
        null,
        2,
      ),
    );

    return isValidKeysetHash;
  }

  const [dasKeySetInfo, keysetCreationBlock] = await Promise.all([
    parentChainPublicClient.readContract({
      address: coreContracts.sequencerInbox,
      abi: sequencerInboxDacAbi,
      functionName: 'dasKeySetInfo',
      args: [keysetHash],
    }),
    parentChainPublicClient.readContract({
      address: coreContracts.sequencerInbox,
      abi: sequencerInboxDacAbi,
      functionName: 'getKeysetCreationBlock',
      args: [keysetHash],
    }),
  ]);

  console.log('DAC keyset contract state:');
  console.log(
    JSON.stringify(
      {
        sequencerInbox: coreContracts.sequencerInbox,
        keysetHash,
        isValidKeysetHash,
        dasKeySetInfo: {
          isValidKeyset: dasKeySetInfo[0],
          creationBlock: dasKeySetInfo[1].toString(),
        },
        keysetCreationBlock: keysetCreationBlock.toString(),
      },
      null,
      2,
    ),
  );

  return isValidKeysetHash;
}

const deployer = await getDeployerAccount();
const keyset = getDacKeyset();
const keysetHash = prepareKeysetHash(keyset);

console.log('DAC keyset hash:', keysetHash);

const isAlreadyValid = await printDacKeysetState(keysetHash);

if (isAlreadyValid) {
  console.log('DAC keyset is already valid. Skipping setValidKeyset transaction.');
  process.exit(0);
}

const transactionRequest = await setValidKeysetPrepareTransactionRequest({
  coreContracts,
  keyset,
  account: deployer.address,
  publicClient: parentChainPublicClient,
});

const hash = await parentChainPublicClient.sendRawTransaction({
  serializedTransaction: await deployer.signTransaction(transactionRequest),
});
const transactionReceipt = await parentChainPublicClient.waitForTransactionReceipt({ hash });

console.log('Set DAC keyset transaction receipt:');
console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

await printDacKeysetState(keysetHash);
