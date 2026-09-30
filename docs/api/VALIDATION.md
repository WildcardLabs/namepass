# Public API validation

The public integration API is unreleased. Its previous validation and implementation are
retained in draft [PR #117](https://github.com/wildcardlabs/namepass/pull/117).
Migration-applied fixtures did not test compatibility with beta's deployed `0008` schema.

The recovery regression in `server/production-schema.test.ts` creates a disposable PostgreSQL
database with only migrations `0000`–`0008`. It checks explorer pagination, canonical renewal
filtering, name history, authenticated Goldsky ingestion, replay without duplicate rows, and
visibility of the queued deposit flow. It uses the real database store and route handlers.
Workflow dispatch is replaced; the test does not broadcast a transaction or prove live settlement.

Run it with a loopback `TEST_DATABASE_URL`, then run the required CI suite. Public Markdown,
agent resources and OpenAPI remain available as the planned contract and explicitly report
that the integration API is not available. Hosted release evidence remains required by
[DEPLOYMENTS.md](../DEPLOYMENTS.md#integration-release-gate).
