import { expectPositionalArgs } from '../common.js';
import { getDacKeysetConfig } from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/crynux-on-base/generate-dac-keyset-config.ts');

const dacKeyset = getDacKeysetConfig();

console.log(
  JSON.stringify({
    keyset: {
      enable: true,
      ...dacKeyset,
    },
  }),
);
