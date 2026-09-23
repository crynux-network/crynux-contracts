import { expectPositionalArgs } from '../../common.js';
import { orbitRuntime, getDacKeysetConfig } from './runtime.js';

expectPositionalArgs(0, `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/generate-dac-keyset-config.ts`);

const dacKeyset = getDacKeysetConfig();

console.log(
  JSON.stringify({
    keyset: {
      enable: true,
      ...dacKeyset,
    },
  }),
);
