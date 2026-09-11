# Security Policy

## Reporting a vulnerability

Email **support@bytephase.com** with the details. Please do not open a public issue, and please do
not include a working exploit in the first message.

Tell us what you can: what the issue is, how to reproduce it, and what an attacker could reach. We
will acknowledge the report and keep you updated while we work on it.

## What this package can reach

Worth knowing before you assess impact.

- The node is a **client**. It holds no data of its own, writes nothing to disk, and has **zero
  runtime dependencies**.
- The credential holds a **Base URL and an API key**. n8n stores it encrypted with the instance's
  encryption key; the node never logs it, and it is write-only in the n8n UI.
- The key is **scoped to intake in one workspace**. It can create leads and self check-ins. It cannot
  read customers, repairs, invoices or settings, and it cannot reach another workspace. That bounds
  what a leaked key is worth — but rotate it anyway.

## If a key leaks

Generate a new one in BytePhase under **Settings → Integrations → n8n**. The old key stops working
immediately. Keys can also be given an expiry date there.

## Scope

Issues in **this package** belong here. Issues in the **BytePhase API** itself — an endpoint
returning data it should not, an authentication bypass — should go to the same address, referencing
the [API specification](https://developers.bytephase.com) and the `X-Request-Id` of an affected
response.
