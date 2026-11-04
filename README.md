# UVR Home Support Portal

Static, public-facing frontend for the support team. Ticket data stays in Supabase; access is enforced by database grants, row-level security, role checks, and mandatory MFA.

The repository is public because GitHub Pages is free for public repositories. Only the portal source and the Supabase publishable key are public. Never add a Supabase secret/service-role key, database password, or agent credentials.

## GitHub Pages setup

1. In **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
2. Add these repository variables under **Settings → Secrets and variables → Actions → Variables**:
   - `SUPPORT_SUPABASE_URL`
   - `SUPPORT_SUPABASE_PUBLISHABLE_KEY`
3. In Supabase **Authentication → URL Configuration → Redirect URLs**, allow the portal's GitHub Pages URL.
4. On the staging project only, apply migration `20261115000000_support_agent_access.sql`. Invite the owner's account in Supabase **Authentication → Users**, then add that account as the single owner in the SQL Editor:

   ```sql
   do $$
   declare
     owner_user_id uuid;
   begin
     select id into owner_user_id from auth.users
     where lower(email) = lower('dueno@ejemplo.com');
     if owner_user_id is null then
       raise exception 'Primero invitá la cuenta propietaria en Supabase Authentication.';
     end if;
     if exists (
       select 1 from private.support_agents
       where role = 'owner' and user_id <> owner_user_id
     ) then
       raise exception 'Ya existe otra cuenta propietaria.';
     end if;
     insert into private.support_agents (user_id, role, active)
     values (owner_user_id, 'owner', true)
     on conflict (user_id) do update set role = 'owner', active = true;
   end
   $$;
   ```

5. Sign in with the owner's email and configure TOTP. The **Resumen** dashboard shows ticket volume, statuses, recent activity, and agent workload. Active tickets are automatically assigned to the available agent with the fewest active tickets; if nobody is available, they stay unassigned in the owner's queue. Agents can pause or resume assignment without losing their current tickets. From **Usuarios**, the owner can invite new users or add existing UVR Home accounts, and enable or disable agents. Existing accounts do not receive another invitation email; they can request a magic link after being added. From **Tickets**, the owner can override automatic assignment; agents can only see and answer tickets assigned to them. Public signups stay disabled, and requesting a magic link never creates an account.

## Profiles and customer context

Apply migration `20261121000000_support_profiles_and_client_context.sql` before publishing this version. It adds each team member's display name, description and photo (private `support-avatars` bucket, 1 MB, JPG/PNG/WebP, one folder per person) and the `support_ticket_client_context` RPC. **Mi perfil** edits your own data; photos are cropped to a square in the browser and served with signed URLs. The ticket detail shows a customer panel with verified/unverified identity, member-since date, completed and cancelled services, and ticket counts. It never exposes email, phone, ID documents or addresses. If the migration is missing, the portal keeps working without profiles or the customer panel.

Pushing to `main` builds and deploys the site. The workflow fails if either public Supabase variable is missing.

## Local build

Run `npm ci`, then provide the public Supabase configuration and run `npm run build`:

```powershell
$env:VITE_SUPABASE_URL = "https://TU-PROYECTO.supabase.co"
$env:VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TU_CLAVE"
npm run build
```

The browser bundle necessarily contains the publishable key. Supabase RLS and RPC authorization—not secrecy of the frontend or key—protect tickets.
