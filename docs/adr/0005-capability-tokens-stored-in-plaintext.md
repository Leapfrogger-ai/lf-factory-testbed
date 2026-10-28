---
status: accepted
initiative: calvin
---

# Capability tokens are stored in plaintext

calvin's public, manage, withdraw and check-in tokens are 256-bit random strings (`randomBytes(32).toString('base64url')`), stored as plaintext `TEXT UNIQUE` columns on `plans` and `commits` and looked up by equality. They aren't hashed, because calvin has to rebuild them: every email is built only from stored data so a retried send carries exactly the same payload (ADR 0002), and the reminder, confirmation, call-off and check-in emails all contain the recipient's withdraw, manage or check-in link. The published screen and the manage page also show the public link again.

## Considered Options

- **Store a SHA-256 hash, and the token only in the first email.** Later emails couldn't carry the link, and a retried email couldn't be rebuilt identically.
- **Encrypt the tokens with an app key.** Protects against a database-only leak, but adds a secret, key rotation and a decrypt on every email for a PoC whose database also holds the email addresses in plaintext.

## Consequences

- Anyone who can read the database can act as any creator or committer. At PoC scale, the Neon credentials in `DATABASE_URL` (a Fly secret) are the protection.
- Moving to hashed tokens later needs a migration and new links for every live plan, so it should happen between trials, not during one.
- Logs must keep redacting tokens (architecture, Logging Strategy), since they're as good as the database's copy.
