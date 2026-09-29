# Receive webhooks

## Signed notifications, with replay

Create an endpoint with `POST /webhook-endpoints`. Store the one-time `signingSecret`, then call `POST /webhook-endpoints/{id}/verify`. The endpoint becomes active after your server accepts its signed `endpoint.verification` event. Empty `eventTypes` subscribes to all eligible events.

## Verify the raw body

Verify the Standard Webhooks headers `webhook-id`, `webhook-timestamp` and `webhook-signature` against the exact raw body before parsing JSON. The signed value is `id.timestamp.body`, authenticated with HMAC-SHA256 and the base64-decoded secret after `whsec_`. Accept timestamps within five minutes and compare signatures in constant time.

## Persist and deduplicate

Persist the event and deduplication ID before returning `2xx`; process it asynchronously. Delivery is at least once and may arrive out of order. Upsert only newer resource versions. The replay feed is the recovery authority. During secret rotation, deliveries carry both signatures for 24 hours.

## Retries and timeouts

Attempts time out after 20 seconds. Network failures, `408`, `429` and `5xx` retry with delays of 10 seconds, 1 minute, 5 minutes, 30 minutes, 2 hours and then 6 hours, within 72 hours. Other `4xx` and redirects pause the delivery. Public HTTPS on port 443 is required; private destinations, redirects and DNS rebinding are blocked.

## Manage delivery

Inspect `/webhook-deliveries`, test an endpoint, rotate its secret, or replay an original event. Editing an endpoint pauses pending deliveries from its previous configuration. Replay is explicit after the destination is verified. Test and verification events must never be treated as customer settlements.
