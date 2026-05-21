import { prepareKeysetHash, setValidKeysetPrepareTransactionRequest } from '@arbitrum/chain-sdk';
import { parseAbi } from 'viem';
import {
  getDacCoreContracts,
  getDacKeyset,
  getRollupDeployerAccount,
  parentChainPublicClient,
} from './common.js';

const sequencerInboxDacAbi = parseAbi([
  'error NoSuchKeyset(bytes32 keysetHash)',
  'function isValidKeysetHash(bytes32 ksHash) view returns (bool)',
  'function dasKeySetInfo(bytes32 ksHash) view returns (bool isValidKeyset, uint64 creationBlock)',
  'function getKeysetCreationBlock(bytes32 ksHash) view returns (uint256)',
]);

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

const rollupDeployer = await getRollupDeployerAccount();

const coreContracts = getDacCoreContracts();
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
  account: rollupDeployer.address,
  publicClient: parentChainPublicClient,
});

const hash = await parentChainPublicClient.sendRawTransaction({
  serializedTransaction: await rollupDeployer.signTransaction(transactionRequest),
});
const transactionReceipt = await parentChainPublicClient.waitForTransactionReceipt({ hash });

console.log('Set DAC keyset transaction receipt:');
console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

await printDacKeysetState(keysetHash);
