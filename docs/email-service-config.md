# Email Service Configuration Fix

## Current Issue
Email sending is failing with:
```
connect ECONNREFUSED 127.0.0.1:587
```

This is because there's no SMTP server running on localhost:587.

## Solution Options

### Option 1: Use Mailpit (Fake SMTP for Development) ✅ RECOMMENDED

Mailpit is a fake SMTP server that captures emails for testing.

**Start Mailpit**:
```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

**Update `.env.development`**:
```bash
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_USER=
MAIL_PASS=
MAIL_FROM=noreply@magicpages.com
```

**View Emails**: Open http://localhost:8025 in your browser to see captured emails.

### Option 2: Use Gmail SMTP

**Update `.env.development`**:
```bash
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-app-password  # Generate from Google Account settings
MAIL_FROM=your-email@gmail.com
```

**Note**: You need to generate an "App Password" from your Google Account settings.

### Option 3: Use SendGrid

**Update `.env.development`**:
```bash
MAIL_HOST=smtp.sendgrid.net
MAIL_PORT=587
MAIL_USER=apikey
MAIL_PASS=your-sendgrid-api-key
MAIL_FROM=verified-sender@yourdomain.com
```

## Recommended for Development

Use **Option 1 (Mailpit)** because:
- ✅ No configuration needed
- ✅ Works offline
- ✅ Web UI to view emails
- ✅ No rate limits
- ✅ No real emails sent

## After Configuration

Restart your dev server and test registration. You should see:
```
[MailService] Verification email sent successfully to user@example.com
```

And no more `ECONNREFUSED` errors!
