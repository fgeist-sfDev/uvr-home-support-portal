# UVR Home Support Portal

Static, public-facing frontend for authorized support agents. Ticket data stays in Supabase; access is enforced by database grants, row-level security, and the `private.support_agents` allowlist.

The repository is public because GitHub Pages is free for public repositories. Only the portal source and the Supabase publishable key are public. Never add a Supabase secret/service-role key, database password, or agent credentials.

## GitHub Pages setup

1. In **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
2. Add these repository variables under **Settings → Secrets and variables → Actions → Variables**:
   - `SUPPORT_SUPABASE_URL`
   - `SUPPORT_SUPABASE_PUBLISHABLE_KEY`
3. In Supabase **Authentication → URL Configuration → Redirect URLs**, allow the portal's GitHub Pages URL.
4. For each agent, first create or invite their account in Supabase **Authentication → Users**. Public signups are disabled; requesting a magic link does not create an account. After the agent accepts the invitation, authorize their UUID in the SQL Editor:

   ```sql
   insert into private.support_agents (user_id)
   select id from auth.users
   where lower(email) = lower('agente@ejemplo.com')
   on conflict (user_id) do nothing;
   ```

5. The agent can then request a magic link from the portal using that same email. If the account does not exist yet, the portal explains in Spanish that an administrator must invite and authorize it. Ticket access is still enforced by Supabase RLS and the `private.support_agents` allowlist.

Pushing to `main` builds and deploys the site. The workflow fails if either public Supabase variable is missing.

## Local build

Run `npm ci`, then provide the public Supabase configuration and run `npm run build`:

```powershell
$env:VITE_SUPABASE_URL = "https://TU-PROYECTO.supabase.co"
$env:VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TU_CLAVE"
npm run build
```

The browser bundle necessarily contains the publishable key. Supabase RLS and RPC authorization—not secrecy of the frontend or key—protect tickets.
