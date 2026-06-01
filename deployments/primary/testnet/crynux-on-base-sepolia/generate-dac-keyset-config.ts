import { getDacKeysetConfig } from './common.js';

const dacKeyset = getDacKeysetConfig();

console.log(
  JSON.stringify({
    keyset: {
      enable: true,
      ...dacKeyset,
    },
  }),
);
