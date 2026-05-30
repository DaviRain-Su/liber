# Liber on-chain registry (Sui Move)

A minimal Move package that makes published **books** and **CC0 works /
conversations** verifiable on-chain, independent of Liber's servers. It is
**optional**: the app runs fully without it (Walrus is the real storage; chain
registration is a no-op until configured).

## What it does

`liber::registry::register(content_id, kind, license)`:

1. **Provenance / 存证** — creates an immutable `Record { content_id, kind,
   license, publisher, epoch }`. Authorship, time and license become
   independently verifiable, not dependent on our database.
2. **Ownership / 所有权** — the `Record` is returned to the caller's transaction
   block, which can transfer it to the publisher wallet or compose it with other
   calls.
3. **Open event source** — emits a `Registered` event, so anyone (including
   agents who don't trust our API) can build their own index from chain events.

Comments / highlights / votes intentionally stay **off-chain** (D1) — high
frequency, low value per item.

## Deploy (you / your deploy agent — needs a keypair + gas)

```bash
# 1. install Sui CLI, create/import an address, get testnet gas
sui client faucet

# 2. publish the package
cd move
sui client publish --gas-budget 100000000
#   → note the published packageId from the output

# 3. configure the backend (Cloudflare Pages env)
#    SUI_RPC        = https://fullnode.testnet.sui.io:443   (already set)
#    SUI_PACKAGE    = <packageId from step 2>
#    SUI_MODULE     = registry        (default; can omit)
#    SUI_SIGNER_KEY = <suiprivkey1… of a funded address>   (Pages SECRET; needs gas)
```

Once `SUI_PACKAGE` + `SUI_SIGNER_KEY` are set, `POST /api/works` and
`POST /api/shares` call `register(...)` after writing the Walrus blob, transfer
the returned `Record` to the backend signer, and store the resulting object id /
tx digest in `blobs.sui_index`. With either unset the call is skipped and
publishing is unaffected.

## Verify

```bash
# the object created for a registration
sui client object <objectId>
# or read Registered events to (re)build an index off-chain
sui client events --package <packageId>
```

## Notes

- `register` is permissionless: today our backend signer calls it, but any
  address can register its own content — fitting the open / agent-friendly goal.
- The backend signer pays gas. Budget accordingly, or have users sign their own
  registration tx client-side later (the adapter can be extended for that).
- Multi-chain is optional and separate: the backend's chain adapter
  (`functions/lib/chains/`) can add EVM/Solana equivalents without touching app
  code. You do **not** need to deploy to multiple chains.
