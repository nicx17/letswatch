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
- Trusted Types is enabled with `require-trusted-types-for 'script'`.
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

- normal room events are limited per socket
- image chat sends have a separate per-socket limit
- auth flows have a separate limit keyed by client identity and room scope
- limiter entries are pruned after expiry
- socket-owned limiter entries are deleted on disconnect

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
- accepted chat images are still broadcast to all room members
- malformed traffic still consumes parsing, validation, and logging work
- the frontend shell is cached in memory, but requests still execute Express and Socket.IO admission logic

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
