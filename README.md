# n8n-nodes-bytephase

[![npm version](https://img.shields.io/npm/v/n8n-nodes-bytephase?label=npm)](https://www.npmjs.com/package/n8n-nodes-bytephase)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE.md)

An [n8n](https://n8n.io) community node for **[BytePhase](https://bytephase.com)** — repair-shop
management software. It sends **leads** and **device self check-ins** into your BytePhase workspace
from any n8n workflow: web forms, chat bots, spreadsheets, inboxes, WhatsApp flows, marketplaces, or
anything else n8n connects to.

It is a **thin connector**: it collects the fields you fill in, posts them once over an authenticated
HTTPS call, and returns whatever BytePhase created. **All** validation, duplicate detection, device
matching, assignment and notification logic lives in BytePhase. The node holds no business logic,
keeps no state and stores no customer data.

- **Stack:** TypeScript, zero runtime dependencies.
- **API contract:** <https://developers.bytephase.com> — the node is one client of the public
  [BytePhase Integration API](https://github.com/bytephase/bytephase-developers).

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [How it works](#2-how-it-works)
3. [Requirements](#3-requirements)
4. [Installation](#4-installation)
5. [Connecting to BytePhase](#5-connecting-to-bytephase)
6. [Operations & fields](#6-operations--fields)
7. [What BytePhase does with a submission](#7-what-bytephase-does-with-a-submission)
8. [The API underneath](#8-the-api-underneath)
9. [Errors & responses](#9-errors--responses)
10. [Rate limits & idempotency](#10-rate-limits--idempotency)
11. [Security](#11-security)
12. [Example workflows](#12-example-workflows)
13. [Development](#13-development)
14. [Testing](#14-testing)
15. [Troubleshooting](#15-troubleshooting)
16. [Release & publishing](#16-release--publishing)
17. [Roadmap / not yet built](#17-roadmap--not-yet-built)

[Help and links](#help-and-links)

---

## 1. What it does

An enquiry arrives somewhere that isn't your repair shop — a Google Form, an inbox, a Typeform, a
marketplace, a spreadsheet row. Instead of someone re-typing it, n8n picks it up and this node drops
it into BytePhase as a **lead** or a **self check-in**, ready to work on.

```
Any n8n trigger            This node              BytePhase workspace
─────────────────          ─────────              ───────────────────
Gmail / Webhook            Lead → Create          the record appears, assigned,
Google Sheets      ───▶    Self Check-In  ───▶    deduplicated, notified — exactly
Typeform / Form            → Create               as if typed in at the counter
Schedule / Chat
```

**The philosophy:** the node never becomes a second CRM. It has no field mapper, no retry queue and
no local database — n8n already provides all three, and BytePhase owns the business rules.

---

## 2. How it works

```
 n8n workflow
      │
      │  Resource + Operation, Name, Email/Mobile, optional fields
      ▼
 ┌────────────────────────────────┐
 │ BytePhase node                 │
 │                                │
 │  • credential supplies the     │   Authorization: Bearer bp_…
 │    workspace host + bearer key │
 │  • fields become one envelope  │   { destination, form_id, data: {…} }
 │  • validates name + contact    │
 │    before anything is sent     │
 └───────────────┬────────────────┘
                 │  ONE request per item. No retries of its own — n8n owns retry.
                 │  POST {base_url}/integrations/submit
                 ▼
 ┌──────────────────────────────────────────────────────────┐
 │ BytePhase                                                │
 │  1. authenticate the key, resolve the workspace + branch │
 │  2. validate against the destination's rules             │
 │  3. match device type / brand / model / lead source      │
 │  4. check for a duplicate                                │
 │  5. create the record, assign it, fire notifications     │
 │  6. log the submission (raw + mapped) to Activity        │
 └───────────────┬──────────────────────────────────────────┘
                 │
                 ▼
   201 → { "status": "completed", "request_id", "data": { … } }
   200 → { "status": "duplicate",  … }   the existing record
   202 → { "status": "received",   … }   parked pending setup
```

Two properties are worth knowing:

- **The API is served per workspace.** There is no shared API host — your workspace subdomain is part
  of the hostname, which is how BytePhase knows whose data this is. That is why the credential asks
  for a Base URL and nothing else besides the key.
- **The node sends canonical field names.** Unlike the website-form integrations, which forward a
  visitor's arbitrary field names for BytePhase to map, this node already speaks BytePhase's
  vocabulary. **No field mapping is needed in BytePhase.**
- **Custom fields are read from your workspace, not invented.** When you open the Custom Fields
  section the node calls `GET /integrations/custom-fields` and renders whatever your shop has
  defined — including a dropdown's choices. That call happens in the editor, never during an
  execution.

---

## 3. Requirements

| | |
|---|---|
| **n8n** | 1.x (self-hosted, or n8n Cloud with community nodes enabled) |
| **Node.js** | 20+ (only to build from source) |
| **BytePhase** | an active workspace, and permission to create integrations |
| **Network** | your n8n instance must be able to reach your workspace API host over HTTPS |

> **n8n Cloud** shares outbound IP addresses between customers. BytePhase's rate limiter keys on the
> API key, not the IP, so your workspace is never throttled by another company's traffic.

---

## 4. Installation

**From the n8n UI** (recommended) — follow the
[community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/):

**Settings → Community Nodes → Install** → enter `n8n-nodes-bytephase` → confirm.

**Self-hosted, manually:**

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-bytephase
# restart n8n
```

---

## 5. Connecting to BytePhase

### 5.1 Create the integration in BytePhase

**Settings → Integrations → n8n → Connect.** The screen gives you two things:

| Credential field | What it is | Example |
|---|---|---|
| **Base URL** | your workspace's API address | `https://harbor-repair.api.bytephase.com/api` |
| **API Key** | the key issued for this integration | `bp_…` — **shown once**, copy it before you leave |

> ### Getting the Base URL right
>
> This is the single most common setup mistake. The API lives on a different host from the web app:
>
> | | |
> |---|---|
> | You sign in at | `https://harbor-repair.bytephase.com` |
> | The API is at | `https://harbor-repair.`**`api`**`.bytephase.com/api` |
>
> Note the `api.` in the middle **and** the `/api` at the end. A white-label workspace on its own
> domain uses `https://your-domain.com/api` instead.

If you lose the key, generate a new one on the same screen; the old one stops working immediately.

### 5.2 Create the credential in n8n

Add a **BytePhase** node → **Credential to connect with → Create new** → paste the two values →
**Save**.

Saving calls `GET /integrations/ping`, which creates nothing and confirms the key, the host and the
workspace in one request. A success message names your workspace. A failure tells you which of the
three is wrong:

| Message | Cause |
|---|---|
| *Invalid or inactive API key* | wrong, revoked or expired key |
| *This API key is not allowed here* | the key belongs to a different integration type — create it under **n8n** |
| *Workspace not found* | the Base URL host is not a real workspace |
| *Not found — the Base URL must end in /api* | the Base URL points at the web app, not the API |

---

## 6. Operations & fields

### 6.1 Resources

| Resource | Operation | Creates |
|---|---|---|
| **Lead** | Create | an enquiry to quote and follow up later |
| **Self Check-In** | Create | a customer booking a device in before they reach the counter |

### 6.2 The one rule — what every submission must carry

| Field | Required |
|---|---|
| **Name** | **always** |
| **Email** *or* **Mobile Number** | **at least one of the two** |
| everything else | optional |

The node enforces both **before** it sends anything, so a workflow missing a contact fails locally
rather than burning a request.

### 6.3 Additional Fields

Open **Additional Fields** to add any of these. Anything you leave out is not sent.

| Field | Lead | Self Check-In |
|---|---|---|
| Comment | ✓ | ✓ |
| Mobile Country Code | ✓ | ✓ |
| Device Type / Device Brand / Device Model | ✓ | ✓ |
| Address Line / City / State / ZIP Code | ✓ | ✓ |
| Phone Number | ✓ | — |
| Contact Person Name | ✓ | — |
| Source | ✓ | — |
| Next Follow-Up | ✓ | — |
| Serial Number / Serial Number 2 | — | ✓ |
| Device Password | — | ✓ |
| Accessories *(comma-separated → a list)* | — | ✓ |
| Is Data Recovery | — | ✓ |
| Is Pickup Booked | — | ✓ |
| Scheduled On | — | ✓ |

### 6.4 Custom Fields

**Custom Fields** is not a free-text key/value list — the node reads the fields **your shop has
actually defined in BytePhase** and renders them.

Open the section and n8n fetches the definitions for the chosen resource
(`Lead → Create` reads the *Lead* form type, `Self Check-In → Create` reads *Self check-in*), then
shows one input per field, with the right control for its type:

| Defined in BytePhase as | Rendered in n8n as |
|---|---|
| **Text** | a text input |
| **Number** | a number input |
| **Dropdown** | a **dropdown with the same choices as the app** |
| *marked required* | marked required in n8n too |

So a field is defined **once**, in BytePhase. Rename it, add an option to a dropdown, or add a whole
new field, and the node picks it up the next time the list is loaded — nothing in n8n needs editing,
and there are no field names to mistype.

**Two mapping modes**, the standard n8n pair:

- **Map Each Field Below** — fill each field in by hand, or with an expression.
- **Map Automatically** — the node takes values from the incoming item whose keys match your field
  names. Keys that are not a defined custom field are ignored, so upstream noise never leaks into the
  record.

Empty values are dropped rather than sent as blanks. If no custom fields are defined for that record
type, the section says so instead of showing an empty box.

> Custom fields must be defined in BytePhase first: **Settings → Custom Fields**, choosing form type
> **Lead** or **Self check-in**. The node only reads them — it can't create them.

### 6.5 Options

| Option | Purpose |
|---|---|
| **Form ID** | Labels this workflow on BytePhase's **Activity** screen. Give each workflow its own value (`n8n-gmail`, `n8n-bookings`) so you can tell at a glance which produced which record. |
| **Business ID** | Which business (branch) the record belongs to, in a workspace running more than one. Leave empty for the default. |
| **Idempotency Key** | Makes the request safe to retry — see [§10](#10-rate-limits--idempotency). |

### 6.6 Device names don't have to match

**Device Type**, **Device Brand**, **Device Model** and **Source** are matched against the lists your
shop already maintains. A value that matches links the record to the catalogue entry. A value that
does not — `"Framework 13"`, say — is kept on the record as free text rather than rejected. You never
have to keep an n8n workflow in sync with your device catalogue.

---

## 7. What BytePhase does with a submission

Worth understanding, because it explains behaviour you will see in the workflow.

**Duplicate detection.** The two destinations deliberately differ:

| Resource | Rule | On a match |
|---|---|---|
| **Lead** | same mobile number *(with the same country code)* **or** same email | returns the **existing** lead with `200` and `"status": "duplicate"` — no second lead |
| **Self Check-In** | same mobile number on a check-in that is still open | **creates a new one anyway** — a repeat customer with a second device is a second job |

So a workflow that re-runs over the same inbox will not litter your lead list, while a customer who
brings in two laptops correctly gets two check-ins.

**Assignment & notifications.** New records are auto-assigned to your default reception user, and
whatever notifications you have configured fire as usual. Nothing about an n8n submission is treated
as second-class.

**Everything is logged.** Every submission — accepted, duplicate or rejected — appears under
**Settings → Integrations → n8n → Activity** with the raw payload, the mapped payload, the status
code and a request id. That screen is the first place to look when a workflow "worked" but no record
appeared.

---

## 8. The API underneath

The node is a client of the public **BytePhase Integration API**, specified at
<https://developers.bytephase.com>. You can reproduce any call by hand, or build the same thing with
a plain **HTTP Request** node.

| | |
|---|---|
| **Method / URL** | `POST {base_url}/integrations/submit` |
| **`Authorization`** | `Bearer bp_…` (tools that cannot set it may send `X-API-Key` instead) |
| **`Content-Type` / `Accept`** | `application/json` |
| **`Idempotency-Key`** | optional; see [§10](#10-rate-limits--idempotency) |

**Request body:**

```json
{
  "destination": "lead",
  "form_id": "n8n-gmail",
  "data": {
    "name": "Ada Lovelace",
    "mobile_number": "9998887777",
    "email": "ada@example.com",
    "comment": "Screen flickering after a drop",
    "device_type": "Laptop",
    "device_brand": "Dell",
    "device_model": "XPS 13",
    "address": { "city": "Pune", "state": "MH", "zip_code": "411001" },
    "custom_fields": { "Warranty": "Expired" }
  }
}
```

`destination` is `lead` or `self_checkin` — that is the node's **Resource**.

**By hand:**

```bash
curl -sS -X POST "https://harbor-repair.api.bytephase.com/api/integrations/submit" \
  -H "Authorization: Bearer bp_your_api_key" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"destination":"lead","form_id":"n8n","data":{"name":"Ada Lovelace","mobile_number":"9998887777"}}'
```

```
HTTP/1.1 201 Created
X-Request-Id: 01M27EXWG3JD74J4G58CSJP64T
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-Business: 1

{ "status": "completed", "request_id": "01M27EXW…", "data": { "id": 9, "object": "lead", … } }
```

**Connection test:**

```bash
curl -sS "https://harbor-repair.api.bytephase.com/api/integrations/ping" \
  -H "Authorization: Bearer bp_your_api_key"
# → {"status":"connected","workspace":"Harbor Repair","provider":"n8n"}
```

---

## 9. Errors & responses

Every response carries an **`X-Request-Id`** header (a ULID) that matches the request id on the
Activity screen. Quote it in any support conversation.

| Code | `status` / `error.code` | Meaning | Node behaviour |
|---|---|---|---|
| `201` | `completed` | record created | returns the new record |
| `200` | `duplicate` | an existing record matched | returns **that** record — treat as success |
| `202` | `received` | accepted but parked pending setup | returns `{"status":"received"}`, no record yet |
| `401` | `credential_missing` / `credential_invalid` | no key, or a wrong/revoked/expired key | node errors |
| `403` | `integration_not_permitted` | the key is not valid for this endpoint | node errors |
| `404` | `business_not_found` | the **Business ID** does not exist | node errors |
| `422` | `validation_failed` | a value BytePhase rejected | node errors with the reason |
| `423` | `workspace_not_ready` | workspace still being provisioned | node errors — retry shortly |
| `429` | `rate_limit_exceeded` | see [§10](#10-rate-limits--idempotency) | node errors |
| `5xx` | `internal_error` | something broke on BytePhase's side | node errors — quote the request id |

Errors use one shape, and the node surfaces the readable part rather than a bare status code:

```json
{
  "error": {
    "code": "business_not_found",
    "message": "Business not found.",
    "request_id": "01M27EXX3CPFDXBNHF28RFCHMH",
    "documentation_url": "https://developers.bytephase.com/errors#business_not_found"
  },
  "message": "Business not found."
}
```

The node shows `Business not found.` with `Code: business_not_found · Request ID: 01M27EXX…` as the
description.

**Recommended n8n settings** on the node: enable **Retry On Fail** (2–3 attempts) to ride out `429`,
`423` and `5xx`. Leave **Continue On Error** off unless a failed record genuinely should not stop the
workflow — a `422` means the data was wrong, and retrying it will not help.

---

## 10. Rate limits & idempotency

**Rate limits.** Each API key may make **60 requests per minute**. Every response carries
`X-RateLimit-Limit` and `X-RateLimit-Remaining`; a `429` also carries `Retry-After`. The limit is
keyed on the key rather than the IP, so n8n Cloud's shared outbound addresses cannot cause one
customer's workflow to throttle another's.

For a bulk backfill, put a **Loop Over Items** with a small **Wait** in front of the node.

**Idempotency.** Set the **Idempotency Key** option — a fresh UUID per logical submission, reused on
retry. A replay returns the original outcome with `"status": "duplicate"` and the **original**
`request_id`, instead of creating a second record.

```
Idempotency Key = {{ $json.message_id }}      // stable per source message
Idempotency Key = {{ $execution.id }}-{{ $itemIndex }}
```

Without a key you are still protected from double leads by BytePhase's duplicate detection
([§7](#7-what-bytephase-does-with-a-submission)) — but a key is the stronger guarantee, and the only
one that also covers self check-ins.

---

## 11. Security

- **The API key is stored by n8n as a credential**, encrypted at rest with your n8n encryption key,
  and is write-only in the UI. This node never logs it.
- **The key is scoped to intake.** It can create leads and check-ins in exactly one workspace. It
  cannot read your customer list, your repairs or your invoices, and it cannot reach another
  workspace. Losing it does not expose data.
- **BytePhase stores only a hash of the key.** A leaked key is revoked by generating a new one on the
  Connect screen; the old one dies immediately. Keys can also be given an expiry.
- **Transport is HTTPS**, and the workspace is resolved from the hostname rather than from anything
  in the request body, so a malformed payload cannot cross into another workspace.

Found a security issue? Please email **support@bytephase.com** rather than opening a public issue.

---

## 12. Example workflows

**Inbox enquiry → Lead**

```
Gmail Trigger ──▶ Information Extractor ──▶ BytePhase
 (label: enquiries)   (name, phone, problem)   Lead → Create
                                               Name    = {{ $json.name }}
                                               Mobile  = {{ $json.phone }}
                                               Comment = {{ $json.problem }}
                                               Form ID = n8n-gmail
                                               Idempotency Key = {{ $json.messageId }}
```

**Booking webhook → Self Check-In**

```
Webhook ──▶ BytePhase
 (POST)      Self Check-In → Create
             Name          = {{ $json.customer_name }}
             Mobile Number = {{ $json.phone }}
             Device Type   = {{ $json.device }}
             Serial Number = {{ $json.serial }}
             Is Pickup Booked = true
             Form ID       = n8n-booking-form
```

**Spreadsheet backfill**

```
Google Sheets ──▶ Loop Over Items ──▶ Wait (1s) ──▶ BytePhase
 (read rows)       (batch size 1)                    Lead → Create
```

The `Wait` keeps you inside the 60/minute limit, and duplicate detection means re-running the
backfill will not create a second copy of anyone.

---

## 13. Development

```bash
git clone https://github.com/bytephase/n8n-nodes-bytephase.git
cd n8n-nodes-bytephase
npm install

npm run build     # tsc → dist/, then copies the icon
npm run dev       # tsc --watch
npm run lint      # the same ruleset n8n verification applies
npm run lintfix
```

**Repository layout**

```
credentials/
  BytePhaseApi.credentials.ts   Base URL + API Key, bearer auth, the ping test
nodes/BytePhase/
  BytePhase.node.ts             the whole node: resources, fields, execute()
  bytephase.svg                 the icon shown on the canvas
gulpfile.js                     tsc emits only JS, so the icon is copied separately
index.js                        package entry point; n8n loads via package.json "n8n"
```

The node is **programmatic** (it has an `execute()` method) rather than declarative, because it does
things routing alone cannot: validate *email-or-mobile* before sending, split **Accessories** into a
list, and resolve the **Custom Fields** mapper — including its *Map Automatically* mode. Everything
else is a straight field-to-JSON mapping.

Custom fields are served by the `resourceMapping.getCustomFields` method, which calls
`GET /integrations/custom-fields?form_type=…` and translates BytePhase's `Text` / `Number` /
`Dropdown` into n8n's `string` / `number` / `options`. A dropdown that comes back with no choices is
downgraded to a text input rather than rendered as an empty picker.

**Testing a local build inside n8n:**

```bash
npm run build && npm pack
docker exec -w /home/node/.n8n/nodes <n8n-container> \
  npm install --omit=peer /path/to/n8n-nodes-bytephase-0.1.0.tgz
# restart n8n
```

> `--omit=peer` matters: `n8n-workflow` is a peer dependency, and letting npm install it pulls in
> native modules (`isolated-vm`) that fail to build in the n8n image.

**Constraints that must hold** — they are n8n verification requirements:

- **zero runtime dependencies** (`dependencies` stays empty);
- the package name starts `n8n-nodes-` and carries the `n8n-community-node-package` keyword;
- one service per package;
- an SVG icon, not a bitmap;
- `npm run lint` passes;
- publishing goes through GitHub Actions with npm provenance.

---

## 14. Testing

### 14.1 Verify the credential

Saving the credential calls `GET /integrations/ping`. It creates nothing, so run it as often as you
like. Success names your workspace.

### 14.2 Execute the node

1. Add a **BytePhase** node → **Lead → Create**.
2. Name `Test Lead`, Mobile Number `9000000001`, Form ID `n8n-test`.
3. **Execute step** → expect `"status": "completed"` and a record `id`.
4. Run it **again, unchanged** → expect `"status": "duplicate"` and the **same** id. That proves
   duplicate detection works and a re-run is safe.

### 14.3 Verify inside BytePhase

| Where | What you should see |
|---|---|
| **Leads** list | the new lead, assigned to your default reception user |
| **Self Check-ins** | the new check-in, status *Open* |
| **Settings → Integrations → n8n → Activity** | one row per submission — status, response code, request id, and a drill-down into the exact payload |

The Activity screen is the source of truth. If n8n reports success but you cannot find the record,
check you are looking at the right business within the workspace.

### 14.4 The matrix worth running once

| Test | Expected |
|---|---|
| Name filled, Email **and** Mobile both empty | node fails locally: *Either Email or Mobile Number must be set.* |
| Same lead twice | second returns `duplicate` with the first record's id |
| Same **Idempotency Key** twice | second returns `duplicate` with the **original** `request_id` |
| Self Check-In with `Accessories: charger, case` | stored as the list `["charger","case"]` |
| Open **Custom Fields** on a Lead | shows the *Lead* custom fields defined in BytePhase, dropdowns carrying the app's choices |
| Switch the resource to Self Check-In | the field list changes to the *Self check-in* definitions |
| Fill a dropdown custom field | the chosen value appears in the record's custom fields |
| **Map Automatically** with matching keys on the input item | those fields are filled; unmatched keys are ignored |
| A record type with no custom fields defined | the section says so rather than showing an empty box |
| **Business ID** set to a non-existent id | *Business not found.* |
| Wrong API key | *Invalid or inactive API key.* |
| Base URL set to the sign-in address | credential test fails asking for the `/api` host |
| Device Model not in your catalogue | succeeds — kept verbatim on the record |

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Credential test fails with a 404 or HTML | **Base URL** is the sign-in address | use the API host — `https://{workspace}.api.bytephase.com/api` |
| *Invalid or inactive API key* | key wrong, revoked or expired | regenerate on the Connect screen and update the credential |
| *This API key is not allowed here* | the key was issued for a different integration type | create it under **Integrations → n8n** |
| *Workspace not found* | the host is not a real workspace subdomain | check the spelling of the subdomain |
| *Business not found* | **Business ID** does not exist in this workspace | clear it to use the default |
| `422` on every run | an expression resolves to something BytePhase rejects | open the node output and check what was actually sent |
| `429` during a bulk run | 60/minute per key | add **Loop Over Items** + **Wait** |
| Node succeeds, no record appears | it was a `duplicate`, or `received` (parked) | check `status` in the output, then the Activity screen |
| Node not visible after install | n8n not restarted, or community nodes disabled | restart n8n; on Cloud, enable community nodes |
| Local install fails building `isolated-vm` | npm installed the `n8n-workflow` peer dependency | reinstall with `--omit=peer` |

---

## 16. Release & publishing

Publishing is automated. `.github/workflows/release.yml` runs on a `v*` tag and publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements), which n8n has required for
community nodes since May 2026.

CI runs on Node 24: `n8n-workflow` pulls in `isolated-vm`, which needs Node ≥ 22 and fails to
install on Node 20.

First publish (the package must exist before Trusted Publishing can be configured):

1. On npmjs.com create a **granular access token** with publish rights and save it as the
   `NPM_TOKEN` secret in this GitHub repository.
2. Tag the current version: `git tag v0.1.0 && git push --tags`.
3. On npmjs.com: **package → Settings → Publishing access → Trusted Publishers** → add this
   GitHub repository and the `release.yml` workflow, then delete the `NPM_TOKEN` secret.

To cut a later release:

```bash
npm version patch          # or minor / major
git push && git push --tags
```

Then submit for verification:
<https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/>

---

## 17. Roadmap / not yet built

An honest list of what this node does **not** do yet.

| Not built | Why |
|---|---|
| **Trigger node** | BytePhase has no outbound webhooks yet, so n8n cannot be *triggered* by a BytePhase event. Planned alongside the outbound-webhook subsystem. |
| **Read / search operations** | no *Find Customer*, *Get Repair*, *List Leads*. The intake key is write-only by design; reads need a Zapier-typed key and a different contract. |
| **Business dropdown** | **Business ID** is typed in, not selected from a list. |
| **Automated test suite** | covered today by `npm run lint`, a type check, and the manual matrix in [§14](#14-testing) against a real workspace. |

---

## Help and links

| | |
|---|---|
| API specification | <https://developers.bytephase.com> |
| BytePhase | <https://bytephase.com> — 15-day free trial |
| Support | support@bytephase.com |
| npm package | <https://www.npmjs.com/package/n8n-nodes-bytephase> |
| n8n community nodes | <https://docs.n8n.io/integrations/community-nodes/> |
| WordPress connector | <https://github.com/bytephase/bytephase-wordpress-plugin> |

## License

[MIT](LICENSE.md)
