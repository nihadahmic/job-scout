# job-scout review app

Next.js 15 + Supabase. Lists the job backlog with filters, and lets one signed-in account change statuses and keep notes.

## Local

```bash
cp .env.example .env.local   # fill in the project URL and publishable key
npm install
npm run dev                  # http://localhost:3000
```

Add `http://localhost:3000/auth/callback` to the Supabase redirect URLs to sign in locally.

## Security model

- The browser only has the publishable key. What it can read is decided by row-level security: every table answers only to the user in `app_owner`.
- The app can update `notes` and call `change_status()`; nothing else is writable from here. Inserts come from the collector (secret key, server side only).
- The login page never creates accounts. Turn off sign-ups in Supabase as well.
