# Name history

Call `GET /api/v1/names/{name}/renewals` to show renewal history for one ENS name. No platform-wide history endpoint is provided.

## Read a name's history

```bash
curl 'https://beta.namepass.com/api/v1/names/example.eth/renewals?limit=20'
```

The response contains `name`, `currentExpiry`, `expiryUpdatedAt`, `items` and `nextCursor`. Expiry is the stored ENS state; `expiryUpdatedAt` tells you when that state was read. Getting the deposit address refreshes it.

Each item identifies a renewal flow and its source chain, hub transaction, time added, ENS amount, renewal fee, expiry and renewal timestamp. `complete` means its renewal was verified and finalized. `processing` means verification is pending. Unknown evidence remains `null`; it is not a zero value.

## Load more

Pass `nextCursor` as the `cursor` query parameter for the same name. Encode it with `URLSearchParams`. The default limit is 20 and the maximum is 100. A null cursor means no more entries are available. Newest renewals appear first; refresh the first page to see new or late-indexed renewals.

```javascript
const url = new URL("https://beta.namepass.com/api/v1/names/example.eth/renewals");
url.searchParams.set("limit", "20");
if (nextCursor) url.searchParams.set("cursor", nextCursor);
const history = await (await fetch(url)).json();
```

## Scope

History is filtered by ENS name, so an app requests the name its user is viewing. It includes public renewals of that name by any funder. An ENS name is the subject of the query, not a private ownership boundary. A `404` means the name has not been activated; get its deposit address first.
