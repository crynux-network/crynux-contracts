# Crynux on Base Third-Party RPC Full Node

Use `nitro-node.example.yml` as the Nitro node config template. Replace `<BASE_MAINNET_RPC_URL>` with your own Base mainnet RPC endpoint, then mount the config file into the Nitro container and start the node:

```shell
docker run --rm -it \
  -v /data/crynux-base-node:/home/user/.arbitrum \
  -v /path/to/nitro-node.example.yml:/home/user/.arbitrum/nitro-node.yml:ro \
  -p 8547:8547 \
  -p 8548:8548 \
  offchainlabs/nitro-node:v3.11.1-8512b8c \
  --conf.file /home/user/.arbitrum/nitro-node.yml
```

## Chain Parameters

The Crynux on Base chain values are:

- Chain name: `Crynux on Base`
- Chain ID: `18896214`
- Parent chain: `Base`
- Parent chain ID: `8453`
- Native gas token: CNX
- Arbitrum chain type: Orbit AnyTrust

The full Nitro `chain.info-json` value is included in `nitro-node.example.yml`.

## Crynux Values

Crynux provides the following services for the third-party full node:

- Sequencer RPC forwarding target: `https://json-rpc.base.crynux.io`
- DAS REST endpoint: `https://rest.das.base.crynux.io`
- Sequencer feed endpoint: `wss://feed.base.crynux.io`

## Transaction Forwarding

A non-sequencer full node forwards `eth_sendRawTransaction` requests to `https://json-rpc.base.crynux.io`. Read-only RPC calls are served by the third-party full node from its local synchronized state.

## Ports

The example config exposes the third-party RPC service on the Nitro default ports:

- HTTP RPC: `8547`
- WebSocket RPC: `8548`

Crynux publishes the sequencer RPC and DAS REST endpoints over HTTPS on port `443`. The Crynux sequencer feed is a WebSocket endpoint backed by the Nitro feed service on port `9642`.
