# Email/password sign-in and sessions (BE-03)

Apply migrations before starting the API. A single login flow registers new users
as students and signs existing users in. No email-account existence is disclosed.

1. POST /auth/request-code with { "email": "student@example.com" }.
2. Read the six-digit code from email, including any leading zeroes.
3. POST /auth/verify-code with { "email": "student@example.com", "code": "083719" }.
4. Use the returned accessToken as Authorization: Bearer <token>.

The shared `/auth/*` routes remain available for existing clients. New clients should
use the role-specific equivalents: `/student/auth/*`, `/teacher/auth/*`, or
`/admin/auth/*`. The student email-code flow may create a new student. Teacher and
admin flows only sign in an existing account of that exact role; they never create
or upgrade a privileged account.

## Password flows

Every role has the same operations under its own prefix:

| Method | Role-relative path | Authentication | Behavior |
| --- | --- | --- | --- |
| POST | `request-code` | Public | Request an email code for OTP sign-in |
| POST | `verify-code` | Public | Consume an OTP and create a session |
| POST | `login/password` | Public | Sign in with email and password |
| POST | `password/set` | Bearer | Set the first password after verified OTP sign-in |
| POST | `password/change` | Bearer | Verify the current password and replace it |
| POST | `password/reset/request-code` | Public | Request a password-reset-only email code |
| POST | `password/reset/confirm` | Public | Consume the reset code and replace the password |

For example, a teacher uses `/teacher/auth/login/password`; a student uses
`/student/auth/password/reset/confirm`. Passwords are 8–128 characters. They are
stored only as salted scrypt hashes (`N=16384`, `r=8`, `p=1`, 64-byte output); the
entity excludes the hash from normal selects/inserts/updates. Password login is
rate-limited by email and IP using the persisted authentication rate-limit table.

Setting, changing, or resetting a password increments `auth_version` and revokes
all existing sessions. The client must sign in again. `password/set` returns 409 if
a password already exists; use `password/change` with the current password instead.
Reset codes and sign-in codes are stored and consumed under separate purposes, so
one cannot be used in place of the other. Reset requests return the same generic
response for missing accounts and role mismatches, and privileged-role code requests
do not create accounts.

Codes expire in five minutes by default, have five guesses, are HMAC-SHA256 hashed
with a server-side AUTH_OTP_SECRET and become consumed atomically with account/
session creation. Resending replaces the prior code. Failed SMTP delivery invalidates
that request's code. Errors never include codes, SMTP credentials or full provider
responses. A 503 means delivery failed or is not configured; retry after cooldown.

Request/verify limits are persisted in PostgreSQL, including across restarts and
multiple API workers. Defaults: 60 seconds between requests for one email; five
requests per email/hour; twenty per IP/hour; ten verification requests per email
and thirty per IP/five minutes. These are fixed windows. A 429 means retry after
the applicable window. AUTH_* settings in .env.example expose bounded tuning.
The app uses the socket IP and does not trust user-supplied forwarding headers.
If deployed behind a proxy, explicitly configure trust only for that known proxy
before relying on per-client IP quotas; otherwise the proxy shares one quota.

Sessions are stored in auth_sessions and last seven days by default. Both JWT expiry
and database expiry/revocation are enforced on every protected request. POST
/auth/logout revokes the current session; POST /auth/logout-all revokes all sessions
and increments auth_version. Changing a role also invalidates existing sessions.
Sign in again after upgrading from the old tokens without sid. Refresh-token rotation
is not implemented; when a session expires, request a new email code.

## Local SMTP inbox

Use .env.example as the settings reference, without overwriting existing secrets.
Set AUTH_DEV_OTP_ENABLED=false, AUTH_OTP_SECRET to a long independent random secret,
SMTP_HOST=127.0.0.1, SMTP_PORT=1025, SMTP_FROM=Hodhod <no-reply@hodhod.test>,
SMTP_SECURE=false and SMTP_ALLOW_INSECURE_LOCAL=true.

Run npm run mail:dev in a terminal and npm run start:dev in another. The local SMTP
listener binds only to 127.0.0.1:1025. Read captured messages at http://127.0.0.1:8025/.
It retains at most 50 messages in memory and never forwards them externally or
writes codes to disk. Close the process to discard them.

For the explicit development shortcut, NODE_ENV=development plus
AUTH_DEV_OTP_ENABLED=true permits 11111 without email delivery. Neither production
nor test accepts that shortcut, even if the flag is true. Real SMTP is the example
configuration's default. Keep this shortcut off for actual email-flow testing.

## Production SMTP

Configure a verified sender and provider SMTP credentials through the deployment's
secret storage. SMTP_SECURE=true uses implicit TLS (usually port 465). With secure
false, STARTTLS is mandatory except for explicitly allowed local development/test
loopback servers. Production never honors SMTP_ALLOW_INSECURE_LOCAL. Certificate
verification is never disabled. See [Nodemailer's SMTP reference](https://nodemailer.com/smtp).
AUTH_OTP_SECRET must be at least 32 characters; production does not fall back to
JWT_SECRET. Set both to independent generated secrets.

SMTP integration is tested against a real local SMTP listener. Internet delivery,
DNS/sender verification and provider credentials must be configured by the operator
for deployment; no external mail was sent during implementation.

Run npm run test:db for delivery, rate limits, persisted guesses, expiry, concurrent
consumption, failure recovery, production boundaries, session revocation and all
prior database/identity checks. All use disposable PostgreSQL and loopback SMTP.

The EmailAuthentication migration can be reverted, which discards OTP/rate/session
state and requires everyone to sign in again. It does not delete users or domain
data. Roll back the application together with this authentication schema.

The PasswordAuthentication migration adds the nullable `users.password_hash` column
and separates email codes by purpose. Its rollback removes reset-code rows and all
password hashes, so take a backup and roll back the application at the same time.

For maintenance, prune expired auth_sessions and auth_email_codes after the desired
diagnostic retention period, and auth_rate_limits older than one day. This schema
does not require retaining OTP hashes or IP/email rate fingerprints indefinitely.
