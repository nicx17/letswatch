# Security Notes

## Scope

Current repository behavior:

- Video files stay on each participant's machine.
- The server keeps room metadata and playback state in memory while a room is active.
- Chat is broadcast live and is not persisted after delivery.
- There is no database, upload pipeline, or persistent media storage in this repository.

## Implemented Controls

### HTTP Headers

The server uses `helmet` and sets production security headers for the unified frontend/backend deployment.

Current header behavior:

- HSTS is enabled in production.
- CSP uses a per-response nonce on scripts.
- `frame-ancestors` is set to `none`.
- `object-src` is set to `none`.

The production HTML shell is served through a server-side render path so the nonce can be added before the response is sent.

### Input Validation

The server validates the following inputs with Zod:

- room creation payloads
- room join payloads
- share-link join payloads
- playback sync payloads
- display names
- chat text payloads
- chat image payloads

Chat image payloads are restricted to `data:image/...;base64,...` values and are bounded in size.

Socket event handlers also tolerate malformed frames and missing acknowledgement callbacks without throwing.

### Room Access

Room access is based on one of the following:

- room code + 6-digit PIN
- room code + current share token

Implementation details:

- room codes are normalized to uppercase
- PINs are normalized before verification
- the server stores a salted PIN hash, not the raw PIN
- the server stores a hash of the current share token, not the raw token
- PIN-based joins rotate the share token

New rooms use versioned `scrypt` PIN hashes. Legacy hash verification remains in place for older in-memory room formats.

### Membership Checks

Room-scoped actions require the socket to already be attached to the room:

- playback state updates
- playback state reads
- display name updates
- chat messages

Participant lists exposed to the client use opaque participant IDs rather than raw socket IDs.

### Rate Limiting

This repository uses in-memory rate limiting.

Current limiter behavior:

- all room events, including create and join attempts, are limited per socket (15 per 2 seconds)
- image chat sends have a separate per-socket limit (3 per 30 seconds) and a per-room limit (10 per 30 seconds across all senders)
- auth flows are limited per client identity: 20 attempts per minute overall, and 8 per 10 seconds for any one room code
- each room stops accepting PINs for 10 minutes after 30 incorrect PINs from any mix of clients; share-link joins keep working
- `/csp-violation-report` and the HTML shell are limited per client identity (120 requests per minute each)
- expired limiter entries are pruned at most once per second, so the cost of an event does not grow with the number of stored entries
- socket-owned limiter entries are deleted on disconnect, and room-scoped entries are deleted when the room closes

The client identity is the socket's remote address. When `TRUST_PROXY` is set to a hop count, the server counts that many entries from the **right** of `X-Forwarded-For`, so addresses a client injects at the left are ignored. See [`DEPLOYMENT.md`](DEPLOYMENT.md#client-ip-and-trust_proxy).

This limiter is process-local and does not coordinate across replicas.

### Logging

Structured server logs redact or obfuscate sensitive values such as:

- room identifiers
- participant identifiers
- socket identifiers
- PINs
- tokens
- hashes

## Current Limitations

### Authentication Model

This repository does not implement user accounts or long-lived identity.

Anyone with:

- the room code and valid PIN, or
- a current share link token

can join the room and interact with it.

### Process Model

All room state is stored in process memory.

Effects of a restart:

- active rooms are lost
- playback state is lost
- participant lists are lost
- chat history is not recoverable

### DoS Boundaries

The current implementation reduces several low-effort abuse paths, but it is still a single-process Node service.

Important boundaries:

- auth hashing is asynchronous, but still consumes CPU and worker-thread capacity
- rate limits are local to a single process
- accepted chat images are still broadcast to all room members: up to about 900 KB per image, 20 members per room, and 10 images per room every 30 seconds
- any connected socket, including one that has not joined a room, may send frames up to 1 MB (`maxHttpBufferSize`)
- `/csp-violation-report` accepts JSON bodies up to 16 KB and writes each accepted report to the log
- malformed traffic still consumes parsing, validation, and logging work
- the frontend shell is cached in memory, but requests still execute Express and Socket.IO admission logic

### PIN Strength

A room PIN has 10^6 possible values. The per-identity auth limits slow down a single client. The per-room lockout (30 failures per 10 minutes) caps a brute force spread across many addresses at roughly 4,300 guesses a day, so covering half the PIN space would take months.

The lockout has a trade-off: anyone who knows a room code can keep that room's PIN entry locked. Members can still invite people with the share link, which is not affected. Each attempt against an existing room runs `scrypt` on the libuv thread pool, so join attempts still cost CPU until a limit rejects them.

### Share Tokens In URLs

Invite links carry the share token in the URL fragment (`?room=CODE#token=...`). Browsers do not send fragments to servers, so the token stays out of server, proxy, and CDN access logs. The client removes it from the address bar after joining. A share token stays valid until a PIN-based join rotates it or the room closes.

Links copied from older versions put the token in the query string. They still work, but the first page load of such a link sends the token to the server.

### CORS And Origin Checks

The repository uses:

- Express CORS configuration
- Socket.IO CORS configuration
- a production Socket.IO `allowRequest` check

These checks limit browser-origin traffic, but they are not a replacement for edge controls or network-level access controls.

## Deployment Expectations

For public deployments, this repository expects a reverse proxy or edge layer to handle:

- TLS termination
- connection limits
- request size limits
- IP-based rate limiting
- log aggregation and monitoring

## Repository Workflow

The repository includes CI coverage for:

- lint
- test
- build
- CodeQL
- dependency review

These checks help catch regressions, but they do not replace deployment hardening or external abuse controls.
