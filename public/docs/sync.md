# Sync & replay

## Bootstrap once. Resume by cursor.

A timestamp is useful for an initial history query. It is unsafe as your ongoing checkpoint: a transfer created yesterday can settle today, and independent database transactions can commit out of order.

## Create a checkpoint

1. Create the desired watches, then call `POST /sync`.
2. Save its snapshot ID and `eventsCursor`.
3. Page `GET /sync/{id}` until `hasMore` is false. Replace your local resources using their IDs and versions.
4. Poll `GET /events?cursor=…` from that saved event cursor.
5. Commit each batch and its returned `nextCursor` together in your database.

## A consistent view

The snapshot freezes state at one published position and lasts 24 hours. Later commits appear after the saved event cursor, including transactions that started earlier. Resource lists also freeze a position while paging. Do not change filters mid-page. Adding a new watch requires another snapshot for that scope.

## Retention and history

Events are retained for 90 days. `GET /events?from=2026-09-28T00:00:00Z` uses inclusive publication time. Switch to the returned cursor after the first page. A `410` means you must create a fresh snapshot. Canonical resource history remains subject to the deployment’s evidence coverage.
