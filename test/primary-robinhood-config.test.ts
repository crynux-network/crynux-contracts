import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { rhMainnet, rhTestnet } from '@arbitrum/chain-sdk/chains';

type JsonRecord = Record<string, unknown>;

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, 'utf8')) as JsonRecord;
}

describe('Primary Robinhood deployment configuration', () => {
  it('uses the Chain SDK Robinhood networks', () => {
    assert.equal(rhMainnet.id, 4663);
    assert.equal(rhMainnet.name, 'Robinhood Chain');
    assert.equal(rhTestnet.id, 46630);
    assert.equal(rhTestnet.name, 'Robinhood Chain Testnet');
  });

  for (const deployment of [
    {
      environment: 'mainnet',
      baseFolder: 'crynux-on-base',
      rhFolder: 'crynux-on-rh',
      chainId: 18896215,
      name: 'Crynux on RH',
      rpcUrl: 'https://json-rpc.rh.crynux.io',
      dasRpcUrl: 'https://rpc.das.rh.crynux.io',
      dasRestUrl: 'https://rest.das.rh.crynux.io',
    },
    {
      environment: 'testnet',
      baseFolder: 'crynux-on-base-sepolia',
      rhFolder: 'crynux-on-rh-testnet',
      chainId: 188962150,
      name: 'Crynux on RH Testnet',
      rpcUrl: 'https://json-rpc.rh-testnet.crynux.io',
      dasRpcUrl: 'https://rpc.das.rh-testnet.crynux.io',
      dasRestUrl: 'https://rest.das.rh-testnet.crynux.io',
    },
  ] as const) {
    it(`keeps ${deployment.environment} shared parameters aligned with Crynux on Base`, async () => {
      const root = `deployments/primary/${deployment.environment}`;
      const [baseConfig, rhConfig] = await Promise.all([
        readJson(`${root}/${deployment.baseFolder}/config.json`),
        readJson(`${root}/${deployment.rhFolder}/config.json`),
      ]);

      assert.equal(rhConfig.chainId, deployment.chainId);
      assert.equal(rhConfig.name, deployment.name);
      assert.equal(rhConfig.rpcUrl, deployment.rpcUrl);
      assert.equal(rhConfig.minL2BaseFee, baseConfig.minL2BaseFee);
      assert.deepEqual(
        (rhConfig.dacKeyset as JsonRecord)['assumed-honest'],
        (baseConfig.dacKeyset as JsonRecord)['assumed-honest'],
      );
      assert.deepEqual(rhConfig['crynux-contracts-params'], baseConfig['crynux-contracts-params']);

      const backend = ((rhConfig.dacKeyset as JsonRecord).backends as JsonRecord[])[0];
      assert.equal(backend.url, deployment.dasRpcUrl);
      assert.equal(backend.pubkey, '');
      assert.deepEqual(rhConfig.dacRestUrls, [deployment.dasRestUrl]);
      assert.equal(rhConfig.batchPosterAddress, '');
      assert.equal(rhConfig.validatorAddress, '');
      assert.equal((rhConfig.generatedDacKeyset as JsonRecord).keyset, '');
      assert.equal((rhConfig.generatedDacKeyset as JsonRecord).keysetHash, '');
    });
  }
});
