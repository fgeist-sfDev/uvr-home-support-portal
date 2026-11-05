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

## Command palette and shortcuts

`Ctrl/Cmd + K` opens a palette that searches tickets and runs commands: go to a page, filter tickets, take or change the status of the open ticket, insert a quick reply, sign out. In **Tickets**, `J`/`K` move between tickets, `/` focuses the search and `Esc` closes the open ticket (shortcuts are ignored while typing). No backend changes.

## Dark theme and loading states

The portal follows the system theme; the moon/sun button in the account card (or "Usar tema oscuro/claro" in the palette) overrides it and remembers the choice in `localStorage`. The dark styles are generated at build time by `theme-dark.mjs`, a dependency-free Vite plugin that re-maps every color in `src/style.css` (lime and forest surfaces keep their colors); hand-tuned overrides live in `src/theme-dark.css`. While data loads, the inbox, thread, ticket detail and overview show skeletons instead of loading text.

## Attachments

Apply migration `20261124000000_support_ticket_attachments.sql` before publishing this version. It adds the private `support-attachments` bucket (10 MB, JPG/PNG/WebP/PDF, one folder per ticket), the `attachments` column on messages and a `reply_support_ticket(p_ticket_id, p_message, p_attachments)` that checks every file exists in the ticket folder and was uploaded by the sender. In the composer, attach with the clip button, drag and drop or paste (up to 6 files per reply, text optional). Photos are resized to 1600 px and converted to WebP in the browser before uploading; removing a file before sending deletes it. Images show as a grid in the thread and open in a full-screen viewer (arrow keys to browse, `Esc` to close); PDFs show as a card. Files are served with signed URLs that expire after an hour. Internal notes don't take attachments.

## Live updates and presence

Apply migration `20261122000000_support_live_presence.sql`. Tickets and messages arrive over Supabase Realtime (`support_tickets` and `support_ticket_messages` are already in the `supabase_realtime` publication, so each person only receives what their RLS allows) and the portal refreshes within about a second. The private `support-live` channel also shows who else is viewing the open ticket; only active, MFA-verified team members can join it. Polling stays as a safety net (every 2 minutes while the live channel is connected, every 30 seconds otherwise).

Pushing to `main` builds and deploys the site. The workflow fails if either public Supabase variable is missing.

## Desktop notifications and typing

No migration needed. The **Avisos** button in the side menu (also in the command palette) turns desktop notifications on; the browser only asks for permission when the agent clicks it, never on load. Once on, the portal keeps checking in the background and notifies only when it is not in view: new tickets that are mine or unassigned, tickets assigned to me, client replies on my tickets (and unassigned ones for the owner) and internal notes that mention me with `@name`. Several events at once are grouped in a single notification; clicking one opens the ticket. Agents can pause them for an hour or until 9:00 the next day, or send a test. Preferences are saved per user in this browser. The live channel also shares whether someone is typing a reply or an internal note, shown above the composer; it goes quiet after 4 seconds without typing.

## Local build

Run `npm ci`, then provide the public Supabase configuration and run `npm run build`:

```powershell
$env:VITE_SUPABASE_URL = "https://TU-PROYECTO.supabase.co"
$env:VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TU_CLAVE"
npm run build
```

The browser bundle necessarily contains the publishable key. Supabase RLS and RPC authorization—not secrecy of the frontend or key—protect tickets.
