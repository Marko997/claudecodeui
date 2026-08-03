# fix: use a VAPID subject Apple will accept

## Problem

Web push never reaches iOS. Nothing is logged on either side, so the failure is
invisible unless you inspect the send result per endpoint.

`configureWebPush()` hardcodes the VAPID `sub` claim:

```js
webPush.setVapidDetails(
  'mailto:noreply@claudecodeui.local',
  keys.publicKey,
  keys.privateKey
);
```

Apple's push service validates that claim and rejects unroutable domains with
`403 BadJwtToken`. WNS and FCM accept `.local`, so Windows and Android work and
iOS is the only platform that silently gets nothing — which reads like a
device-side permission problem rather than a server bug.

`notifyUserIfEnabled` logs channel send errors, but a per-subscription 403 is
swallowed inside `sendWebPushPayload`'s `allSettled`, so the server log stays
clean.

## Reproduction

Against a live iOS subscription, with the same VAPID key pair and the same
endpoint, varying only the subject:

| `sub` claim | Apple response |
|---|---|
| `mailto:noreply@claudecodeui.local` | `403 {"reason":"BadJwtToken"}` |
| `mailto:noreply@cloudcli.ai` | `201` |
| `https://cloudcli.ai` | `201` |

The same payload to a WNS endpoint returns `201` for all three, which is why
this went unnoticed.

## Fix

- Default the subject to a routable address (`mailto:noreply@cloudcli.ai`).
- Allow operators to point it at their own contact via `VAPID_SUBJECT`.
- Reject values that are neither `mailto:` nor `https://` with a warning
  instead of letting them silently break delivery on one platform.

Existing subscriptions stay valid — the subject is not part of the key pair, so
no client has to resubscribe.

## Notes for reviewers

The startup log line now includes the resolved subject, so a misconfigured
deployment is visible without reproducing a send.

Worth considering separately: `sendWebPushPayload` could log non-410 failures
per endpoint. A 403 from one push service currently leaves no trace, which is
what made this take a while to find.
