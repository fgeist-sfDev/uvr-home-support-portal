import { createClient } from '@supabase/supabase-js';
import './style.css';

const app = document.querySelector('#app');
const statuses = [
  ['open', 'Abierto'],
  ['in_progress', 'En revisión'],
  ['waiting_on_user', 'Esperamos respuesta'],
  ['resolved', 'Resuelto'],
  ['closed', 'Cerrado'],
];
const statusNames = Object.fromEntries(statuses);
const typeNames = { support: 'Ayuda', bug: 'Error de la app' };
const state = {
  supabase: null,
  session: null,
  authorized: false,
  tickets: [],
  messages: [],
  selectedId: null,
  filter: 'open',
  busy: false,
  error: '',
  notice: '',
};

function element(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function setFeedback(error = '', notice = '') {
  state.error = error;
  state.notice = notice;
}

function renderFeedback(parent) {
  if (state.error) parent.append(element('p', 'feedback error', state.error));
  if (state.notice) parent.append(element('p', 'feedback success', state.notice));
}

function renderLogin() {
  const shell = element('main', 'auth-shell');
  const card = element('section', 'auth-card');
  card.append(element('div', 'brand-mark', 'UVR'));
  card.append(element('p', 'eyebrow', 'UVR HOME · SOPORTE'));
  card.append(element('h1', '', 'Entrá al panel'));
  card.append(element('p', 'muted', 'Ingresá con tu correo autorizado. Te mandamos un enlace de acceso.'));
  renderFeedback(card);

  if (!state.supabase) {
    card.append(element('p', 'fine-print', 'El portal todavía no está configurado. Revisá las variables públicas de Supabase en GitHub.'));
    shell.append(card);
    app.replaceChildren(shell);
    return;
  }

  const form = element('form', 'login-form');
  const label = element('label', '', 'Correo del agente');
  const input = element('input', 'text-input');
  input.type = 'email';
  input.name = 'email';
  input.autocomplete = 'email';
  input.required = true;
  input.placeholder = 'nombre@ejemplo.com';
  label.append(input);
  const submit = element('button', 'primary-button', state.busy ? 'Enviando…' : 'Mandarme el enlace');
  submit.type = 'submit';
  submit.disabled = state.busy;
  form.append(label, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = new FormData(form).get('email')?.toString().trim();
    if (!email) return;
    state.busy = true;
    setFeedback();
    renderLogin();
    try {
      const { error } = await state.supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      });
      setFeedback(
        error?.message || '',
        error ? '' : 'Si el correo está habilitado para soporte, vas a recibir el enlace en unos minutos.'
      );
    } catch (error) {
      setFeedback(error.message || 'No pudimos enviar el enlace. Probá de nuevo.');
    } finally {
      state.busy = false;
    }
    renderLogin();
  });
  card.append(form);
  card.append(element('p', 'fine-print', 'El acceso está limitado a las personas habilitadas por UVR Home.'));
  shell.append(card);
  app.replaceChildren(shell);
}

function renderUnauthorized() {
  const shell = element('main', 'auth-shell');
  const card = element('section', 'auth-card');
  card.append(element('div', 'brand-mark', 'UVR'));
  card.append(element('p', 'eyebrow', 'UVR HOME · SOPORTE'));
  card.append(element('h1', '', 'Acceso no habilitado'));
  card.append(element('p', 'muted', 'Tu cuenta no está autorizada para atender tickets. Si pensás que es un error, contactá al administrador.'));
  renderFeedback(card);
  const button = element('button', 'secondary-button', 'Cerrar sesión');
  button.addEventListener('click', signOut);
  card.append(button);
  shell.append(card);
  app.replaceChildren(shell);
}

function renderTicketRow(ticket) {
  const button = element('button', `ticket-row${ticket.id === state.selectedId ? ' selected' : ''}`);
  button.type = 'button';
  const top = element('span', 'ticket-row-top');
  top.append(element('strong', 'ticket-subject', ticket.subject));
  top.append(element('span', `status status-${ticket.status}`, statusNames[ticket.status] || ticket.status));
  button.append(top);
  button.append(element('span', 'ticket-row-meta', `${ticket.client_name} · ${typeNames[ticket.ticket_type] || 'Ayuda'}`));
  button.append(element('span', 'ticket-row-date', formatDate(ticket.last_message_at)));
  button.addEventListener('click', () => selectTicket(ticket.id));
  return button;
}

function renderMessage(message) {
  const bubble = element('article', `message${message.author_role === 'support' ? ' from-support' : ''}`);
  const head = element('div', 'message-head');
  head.append(element('strong', '', message.author_role === 'support' ? 'Equipo UVR Home' : 'Usuario'));
  head.append(element('time', '', formatDate(message.created_at)));
  bubble.append(head, element('p', 'message-body', message.body));
  return bubble;
}

function renderDetail(ticket) {
  const panel = element('section', 'detail-panel');
  const header = element('header', 'detail-header');
  const title = element('div', 'detail-title');
  title.append(element('p', 'eyebrow', `${typeNames[ticket.ticket_type] || 'Ticket'} · ${ticket.client_name}`));
  title.append(element('h2', '', ticket.subject));
  title.append(element('p', 'ticket-context', `App ${ticket.app_version || '—'} · ${ticket.platform} · ${formatDate(ticket.created_at)}`));
  const status = document.createElement('select');
  status.className = 'status-select';
  statuses.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    status.append(option);
  });
  status.value = ticket.status;
  status.setAttribute('aria-label', 'Estado del ticket');
  status.disabled = state.busy;
  status.addEventListener('change', () => updateStatus(ticket.id, status.value));
  header.append(title, status);
  panel.append(header);

  const thread = element('div', 'thread');
  state.messages.forEach((message) => thread.append(renderMessage(message)));
  if (!state.messages.length) thread.append(element('p', 'muted', 'Todavía no hay mensajes.'));
  panel.append(thread);

  const form = element('form', 'reply-form');
  const label = element('label', 'reply-label', 'Respuesta');
  const textarea = document.createElement('textarea');
  textarea.className = 'text-input reply-input';
  textarea.name = 'reply';
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.required = true;
  textarea.placeholder = 'Escribile al usuario…';
  label.append(textarea);
  const footer = element('div', 'reply-footer');
  footer.append(element('span', 'fine-print', 'Al responder, el ticket pasa a “Esperamos respuesta”.'));
  const send = element('button', 'primary-button', state.busy ? 'Enviando…' : 'Enviar respuesta');
  send.type = 'submit';
  send.disabled = state.busy;
  footer.append(send);
  form.append(label, footer);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendReply(ticket.id, new FormData(form).get('reply')?.toString().trim());
  });
  panel.append(form);
  return panel;
}

function renderDashboard() {
  if (!state.authorized) return renderUnauthorized();
  const shell = element('div', 'dashboard');
  const header = element('header', 'app-header');
  const brand = element('div', 'header-brand');
  brand.append(element('div', 'brand-mark small-mark', 'UVR'));
  const brandText = element('div', '');
  brandText.append(element('strong', '', 'UVR Home'), element('span', 'muted', 'Soporte'));
  brand.append(brandText);
  const account = element('div', 'header-account');
  account.append(element('span', 'muted account-email', state.session?.user?.email || 'Agente'));
  const logout = element('button', 'text-button', 'Salir');
  logout.addEventListener('click', signOut);
  account.append(logout);
  header.append(brand, account);
  shell.append(header);

  const content = element('main', 'dashboard-main');
  const toolbar = element('div', 'toolbar');
  const heading = element('div', '');
  heading.append(element('p', 'eyebrow', 'CENTRO DE AYUDA'), element('h1', '', 'Tickets'));
  const controls = element('div', 'toolbar-controls');
  const filter = document.createElement('select');
  filter.className = 'text-input filter-select';
  filter.setAttribute('aria-label', 'Filtrar por estado');
  [['open', 'Abiertos'], ['in_progress', 'En revisión'], ['waiting_on_user', 'Esperando usuario'], ['resolved', 'Resueltos'], ['closed', 'Cerrados'], ['all', 'Todos']].forEach(
    ([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      filter.append(option);
    }
  );
  filter.value = state.filter;
  filter.addEventListener('change', () => {
    state.filter = filter.value;
    renderDashboard();
  });
  const refresh = element('button', 'secondary-button', 'Actualizar');
  refresh.addEventListener('click', loadTickets);
  controls.append(filter, refresh);
  toolbar.append(heading, controls);
  content.append(toolbar);
  renderFeedback(content);

  const columns = element('div', 'dashboard-columns');
  const list = element('aside', 'ticket-list');
  const visible = state.filter === 'all' ? state.tickets : state.tickets.filter((ticket) => ticket.status === state.filter);
  list.append(element('div', 'list-heading', `${visible.length} ${visible.length === 1 ? 'ticket' : 'tickets'}`));
  if (!visible.length) list.append(element('p', 'empty', 'No hay tickets en este filtro.'));
  else visible.forEach((ticket) => list.append(renderTicketRow(ticket)));
  columns.append(list);

  const selected = state.tickets.find((ticket) => ticket.id === state.selectedId);
  if (selected) columns.append(renderDetail(selected));
  else {
    const empty = element('section', 'detail-empty');
    empty.append(element('div', 'empty-icon', '✓'), element('h2', '', 'Elegí un ticket'));
    empty.append(element('p', 'muted', 'Las consultas y reportes de errores van a aparecer acá.'));
    columns.append(empty);
  }
  content.append(columns);
  shell.append(content);
  app.replaceChildren(shell);
}

async function loadTickets() {
  const { data, error } = await state.supabase
    .from('support_tickets')
    .select('id, user_id, client_name, ticket_type, subject, status, app_version, platform, created_at, updated_at, last_message_at')
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (error) {
    setFeedback(error.message);
    renderDashboard();
    return;
  }
  state.tickets = data || [];
  if (state.selectedId && !state.tickets.some((ticket) => ticket.id === state.selectedId)) state.selectedId = null;
  renderDashboard();
}

async function loadMessages(ticketId) {
  const { data, error } = await state.supabase
    .from('support_ticket_messages')
    .select('id, author_role, body, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    setFeedback(error.message);
    renderDashboard();
    return;
  }
  state.messages = data || [];
  renderDashboard();
}

async function selectTicket(ticketId) {
  state.selectedId = ticketId;
  state.messages = [];
  renderDashboard();
  await loadMessages(ticketId);
}

async function sendReply(ticketId, body) {
  if (!body) return;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('reply_support_ticket', {
    p_ticket_id: ticketId,
    p_message: body,
  });
  state.busy = false;
  if (error) {
    setFeedback(error.message);
    renderDashboard();
    return;
  }
  setFeedback('', 'Respuesta enviada.');
  await Promise.all([loadTickets(), loadMessages(ticketId)]);
}

async function updateStatus(ticketId, status) {
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('set_support_ticket_status', {
    p_ticket_id: ticketId,
    p_status: status,
  });
  state.busy = false;
  if (error) setFeedback(error.message);
  else setFeedback('', 'Estado actualizado.');
  await loadTickets();
}

async function signOut() {
  const { error } = await state.supabase.auth.signOut();
  if (error) {
    setFeedback(error.message);
    if (state.authorized) renderDashboard();
    else renderUnauthorized();
  }
}

async function boot() {
  if (!state.session) {
    state.authorized = false;
    renderLogin();
    return;
  }
  const { data, error } = await state.supabase.rpc('is_support_agent');
  if (error) {
    setFeedback(error.message);
    state.authorized = false;
    renderUnauthorized();
    return;
  }
  state.authorized = data === true;
  if (!state.authorized) {
    renderUnauthorized();
    return;
  }
  await loadTickets();
}

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  setFeedback('Falta configurar la URL o la clave pública de Supabase en el despliegue.');
  renderLogin();
} else {
  state.supabase = createClient(url, publishableKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    void boot();
  });
  state.supabase.auth.getSession().then(({ data, error }) => {
    if (error) setFeedback(error.message);
    state.session = data?.session ?? null;
    void boot();
  });
}
