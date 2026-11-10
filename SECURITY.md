# Security

## Reporting a vulnerability

Please report security issues privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue. Expect an answer within a few days.

## Scope

The public demo is a no-login research replay. It holds no personal data: the source dataset is anonymized, and demo sessions are random signed tokens kept in the browser. Things worth reporting include ways to change another session's approval state, bypass input limits or rate limits, read server configuration, or make the API run arbitrary work.

## What the deployment does

- Request bodies over 16 KB are rejected; all inputs are validated with strict schemas.
- Per-IP rate limits on all routes and a tighter limit on solver runs.
- CORS allows only the production origin.
- Secrets live in server-side environment files that are not in this repository.
- Errors return a code, message and request ID, never a stack trace.
