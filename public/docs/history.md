# Name history

Retrieve renewal history and the recorded expiry for an ENS name.

## Read a name's history

```bash
curl 'https://beta.namepass.com/api/v1/names/example.eth/renewals?limit=20'
```

## Response

The response contains `name`, `currentExpiry`, `expiryUpdatedAt`, `items` and `nextCursor`. `currentExpiry` is the last recorded ENS expiry; `expiryUpdatedAt` is its read timestamp. An [address request](/docs/addresses) refreshes this state.

Each item includes a flow ID, source chain, renewal transaction, duration added, amount applied, fee, expiry and renewal timestamp. Its status is `complete` after verification and finality, or `processing` while verification is pending. Unavailable fields are `null`.

## Pagination

Results are ordered newest first. Pass `nextCursor` as the `cursor` parameter to retrieve the next page for the same name. The default page size is 20; `limit` accepts values from 1 to 100. `nextCursor: null` marks the last page. Refresh the first page for new or late-indexed renewals.

```javascript
const url = new URL("https://beta.namepass.com/api/v1/names/example.eth/renewals");
url.searchParams.set("limit", "20");
if (nextCursor) url.searchParams.set("cursor", nextCursor);
const history = await (await fetch(url)).json();
```

## Scope

History is public and includes renewals funded by any sender for the requested name.

## Errors

`404` indicates that the name has not been activated. [Retrieve its deposit address](/docs/addresses) before requesting history.
