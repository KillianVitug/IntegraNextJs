# SMTP Setup

The auth system already sends onboarding OTP and admin invite emails through Nodemailer.

## Recommended production setup

Use a transactional SMTP provider with a verified domain. The default local config now assumes Resend SMTP.

Use these values in `.env.local`:

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<Resend API key>
MAIL_FROM_EMAIL=auth@yourdomain.com
MAIL_FROM_NAME=Mahalo
MAIL_REPLY_TO=you@example.com
```

Notes:

- `MAIL_FROM_EMAIL` must belong to a domain verified with your provider.
- `MAIL_REPLY_TO` is optional. If set, human replies go there instead of the sender mailbox.
- Restart the app after changing SMTP credentials.

## Domain requirements

For production deliverability, configure these DNS records on your sending domain:

- SPF
- DKIM
- DMARC

## Temporary Yahoo fallback

If you must keep Yahoo during migration:

```env
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=killianjarelvitug@yahoo.com
SMTP_PASS=<Yahoo app password>
MAIL_FROM_EMAIL=killianjarelvitug@yahoo.com
MAIL_FROM_NAME=Mahalo
MAIL_REPLY_TO=killianjarelvitug@yahoo.com
```

Notes:

- `SMTP_PASS` must be a Yahoo app password, not your normal Yahoo password.
- If Yahoo returns `535 5.7.0 (#AUTH005) Too many bad auth attempts`, stop retrying, wait out the lockout, create a fresh Yahoo app password, update `.env.local`, and restart the app before testing again.
- Do not use a personal Yahoo mailbox as the long-term production OTP sender.

## Important auth flow note

The bootstrap OTP is not the permanent password.

Flow:

1. Request or receive the onboarding OTP.
2. Verify the OTP in the login onboarding flow.
3. Set a permanent password.
4. Use email plus permanent password for normal login.

## Inbound email

SMTP only sends outbound email. If you want the application to read incoming mail, add a separate inbound mechanism later, such as IMAP polling or an email provider webhook.
