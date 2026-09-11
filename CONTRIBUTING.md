# Contributing

Thanks for taking the time. This is a small, deliberately thin package — a client for the
[BytePhase Integration API](https://developers.bytephase.com) — so most changes are small.

## Before you start

- **A missing field** is usually a one-line change plus a row in the README table. Very welcome.
- **A new resource or a trigger node** depends on API surface that may not exist yet. Open an issue
  first so we can tell you whether the endpoint is there.
- **Behaviour that looks wrong** may be the API, not the node. The
  [specification](https://developers.bytephase.com) is the contract; if a response disagrees with it,
  that is a bug in one of them — report it with the `X-Request-Id` from the response.

## Setup

```bash
npm install
npm run build     # tsc → dist/, then copies the icon
npm run lint      # the same ruleset n8n verification applies
```

`npm run lint` must pass. It is not cosmetic — n8n runs these exact rules when reviewing a community
node, and a failure there blocks the release.

## Testing a change

There is no unit-test suite: the node is a thin mapping layer, and the things worth testing are the
round trips. Test against a real workspace — a free trial works:

```bash
npm run build && npm pack
docker exec -w /home/node/.n8n/nodes <n8n-container> \
  npm install --omit=peer /path/to/n8n-nodes-bytephase-0.1.0.tgz
# restart n8n
```

`--omit=peer` matters: letting npm install the `n8n-workflow` peer dependency pulls in native modules
that fail to build inside the n8n image.

Then run the matrix in [README §14](README.md#14-testing) and confirm the records in BytePhase under
**Settings → Integrations → n8n → Activity**.

## House rules

- **Zero runtime dependencies.** `dependencies` stays empty — this is an n8n verification
  requirement, not a preference.
- **The node does not add business logic.** Validation, duplicate detection, device matching and
  assignment belong in BytePhase. The node's only local checks are the ones that save a pointless
  request.
- **Field names are the API's**, in `snake_case`, unchanged.
- **The icon is an SVG.** Bitmaps fail verification.
- Match the surrounding style; `npm run lintfix` handles most of it.

## Pull requests

One change per PR, with a note on how you tested it. If it touches the field list, update the README
tables in the same PR — they are the documentation people actually read.

## Security

Please do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).
