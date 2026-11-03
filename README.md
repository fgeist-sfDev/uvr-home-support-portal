# UVR Home Support Portal

Static, public-facing frontend for authorized support agents. Ticket data stays in Supabase; access is enforced by database grants, row-level security, and the `private.support_agents` allowlist.

The repository is public because GitHub Pages is free for public repositories. Only the portal source and the Supabase publishable key are public. Never add a Supabase secret/service-role key, database password, or agent credentials.

## GitHub Pages setup

1. In **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
2. Add these repository variables under **Settings → Secrets and variables → Actions → Variables**:
   - `SUPPORT_SUPABASE_URL`
   - `SUPPORT_SUPABASE_PUBLISHABLE_KEY`
3. In Supabase **Authentication → URL Configuration → Redirect URLs**, allow the portal's GitHub Pages URL.
4. Ensure each agent already has a Supabase Auth account and is listed by UUID in `private.support_agents`.

Pushing to `main` builds and deploys the site. The workflow fails if either public Supabase variable is missing.

## Local build

Run `npm ci`, then provide the public Supabase configuration and run `npm run build`:

```powershell
$env:VITE_SUPABASE_URL = "https://TU-PROYECTO.supabase.co"
$env:VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TU_CLAVE"
npm run build
```

The browser bundle necessarily contains the publishable key. Supabase RLS and RPC authorization—not secrecy of the frontend or key—protect tickets.
