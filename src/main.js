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
const TICKET_PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 30000;
const HOUR_MS = 3600000;
// Horas sin respuesta del equipo antes de marcar un ticket como "con demora" o "urgente".
const responseLimits = {
  open: { late: 4, urgent: 24 },
  in_progress: { late: 24, urgent: 48 },
};
const quickReplies = [
  ['Recibimos tu consulta', '¡Hola! Gracias por escribirnos. Ya estamos revisando tu consulta y te respondemos a la brevedad.'],
  ['Pedir más datos', 'Para ayudarte mejor, ¿podés contarnos qué pasos seguiste, qué esperabas que pasara y qué ves en pantalla? Si tenés una captura, mejor.'],
  ['Actualizar la app', 'Probá actualizar la app a la última versión desde la tienda y volvé a intentar. Si el problema sigue, contanos y lo revisamos.'],
  ['Reiniciar la app', 'Cerrá la app por completo, volvé a abrirla y probá de nuevo. Si no se soluciona, avisanos y seguimos con el caso.'],
  ['Resuelto', '¡Listo! Dejamos resuelto el problema. Si algo más falla, respondé este mensaje y lo vemos.'],
  ['Cierre por falta de respuesta', 'Como no tuvimos novedades, vamos a dar el ticket por resuelto. Si todavía lo necesitás, escribinos y lo reabrimos.'],
];
const sortOptions = [
  ['recent', 'Recientes'],
  ['urgent', 'Urgentes primero'],
];
const ticketFilters = [
  ['open', 'Abiertos'],
  ['in_progress', 'En revisión'],
  ['waiting_on_user', 'Esperando'],
  ['resolved', 'Resueltos'],
  ['closed', 'Cerrados'],
];
const state = {
  supabase: null,
  session: null,
  role: null,
  authorized: false,
  tickets: [],
  messages: [],
  agents: [],
  dashboardStats: null,
  selectedId: null,
  filter: 'open',
  ticketSearch: '',
  ticketSort: 'recent',
  ticketLimit: TICKET_PAGE_SIZE,
  ticketTotal: 0,
  ticketsLoaded: false,
  loadingMore: false,
  drafts: {},
  unseenTickets: 0,
  pollTimer: null,
  polling: false,
  page: 'overview',
  busy: false,
  error: '',
  notice: '',
  messageRequest: 0,
  bootRequest: 0,
  ticketRequest: 0,
  agentRequest: 0,
  statsRequest: 0,
  mfaFactorId: null,
  pendingMfaFactorId: null,
  mfaQrCode: '',
  mfaSecret: '',
};

function element(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toLocaleUpperCase('es-AR');
}

function renderAvatar(name) {
  let tone = 0;
  for (const char of String(name || '')) tone = (tone * 31 + char.charCodeAt(0)) % 5;
  return element('span', `avatar tone-${tone}`, initials(name));
}

function formatAge(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function ticketUrgency(ticket) {
  const limits = responseLimits[ticket.status];
  if (!limits || !ticket.last_message_at) return null;
  const hours = (Date.now() - new Date(ticket.last_message_at).getTime()) / HOUR_MS;
  if (hours >= limits.urgent) return { level: 'urgent', label: 'Urgente' };
  if (hours >= limits.late) return { level: 'late', label: 'Con demora' };
  return null;
}

function urgencyRank(ticket) {
  const urgency = ticketUrgency(ticket);
  if (urgency?.level === 'urgent') return 0;
  if (urgency?.level === 'late') return 1;
  return responseLimits[ticket.status] ? 2 : 3;
}

function sortTickets(list) {
  if (state.ticketSort !== 'urgent') return list;
  return [...list].sort((a, b) => urgencyRank(a) - urgencyRank(b)
    || new Date(a.last_message_at) - new Date(b.last_message_at));
}

function updateDocumentTitle() {
  document.title = `${state.unseenTickets ? `(${state.unseenTickets}) ` : ''}Soporte UVR Home`;
}

function showToast(message, actionLabel, onAction) {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = element('div', 'toast-region');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  const toast = element('div', 'toast');
  toast.append(element('span', '', message));
  if (actionLabel && onAction) {
    const action = element('button', 'toast-action', actionLabel);
    action.type = 'button';
    action.addEventListener('click', () => {
      toast.remove();
      onAction();
    });
    toast.append(action);
  }
  const close = element('button', 'toast-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar aviso');
  close.addEventListener('click', () => toast.remove());
  toast.append(close);
  region.replaceChildren(toast);
  window.setTimeout(() => toast.remove(), 12000);
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function setFeedback(error = '', notice = '') {
  state.error = error;
  state.notice = notice;
}

function userFacingError(error, fallback) {
  const message = typeof error?.message === 'string' ? error.message.toLocaleLowerCase('en') : '';
  const code = typeof error?.code === 'string' ? error.code.toLocaleLowerCase('en') : '';

  if (message.includes('email_already_registered')) {
    return 'Ese correo ya tiene una cuenta. Volvé a intentar para habilitarla como agente.';
  }
  if (message.includes('owner_mfa_required')) {
    return 'Solo la persona propietaria, después de validar el segundo factor, puede administrar el equipo.';
  }
  if (message.includes('agent_mfa_required')) return 'Tenés que validar el segundo factor para usar la IA.';
  if (message.includes('rate_limited')) return 'Pediste muchos borradores seguidos. Esperá un minuto y probá de nuevo.';
  if (message.includes('ai_unavailable') || message.includes('not_configured')) {
    return 'La IA no está disponible ahora. Podés responder a mano.';
  }
  if (message.includes('no_messages') || message.includes('ticket_not_found')) {
    return 'Este ticket todavía no tiene mensajes para analizar.';
  }
  if (message.includes('invalid_email')) return 'Revisá que el correo esté escrito correctamente.';
  if (message.includes('cannot_invite_owner')) return 'Tu cuenta ya es la propietaria del portal.';
  if (message.includes('support_account_registration_failed')) return 'No pudimos habilitar esa cuenta. Probá de nuevo o contactá a soporte técnico.';
  if (message.includes('invite_failed')) return 'No pudimos enviar la invitación. Revisá la configuración de correo e intentá de nuevo.';
  if (code === 'signup_disabled' || message.includes('signups not allowed for otp') || message.includes('user not found')) {
    return 'Ese correo todavía no tiene una cuenta de soporte. Pedile a la persona propietaria que te invite desde el panel.';
  }
  if (code === 'over_email_send_rate_limit' || message.includes('rate limit') || message.includes('too many requests')) {
    return 'Se alcanzó el límite de envíos de correo. Esperá unos minutos y volvé a intentar.';
  }
  if (message.includes('invalid email') || message.includes('email address is invalid')) {
    return 'Revisá que el correo esté escrito correctamente.';
  }
  if (message.includes('failed to fetch') || message.includes('network request failed')) {
    return 'No pudimos conectar con el servicio. Revisá tu conexión e intentá de nuevo.';
  }

  console.error('Error en el portal de soporte:', error);
  return fallback;
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
    const userId = state.session?.user?.id;
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
        error ? userFacingError(error, 'No pudimos enviar el enlace. Revisá tu conexión e intentá de nuevo.') : '',
        error ? '' : 'Si el correo está habilitado para soporte, vas a recibir el enlace en unos minutos.'
      );
    } catch (error) {
      setFeedback(userFacingError(error, 'No pudimos enviar el enlace. Revisá tu conexión e intentá de nuevo.'));
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

function renderMfaShell(title, description) {
  const shell = element('main', 'auth-shell');
  const card = element('section', 'auth-card mfa-card');
  card.append(element('div', 'brand-mark', 'UVR'));
  card.append(element('p', 'eyebrow', 'UVR HOME · SEGURIDAD'));
  card.append(element('h1', '', title));
  card.append(element('p', 'muted', description));
  renderFeedback(card);
  const logout = element('button', 'text-button', 'Cerrar sesión');
  logout.addEventListener('click', signOut);
  card.append(logout);
  shell.append(card);
  app.replaceChildren(shell);
  return card;
}

function renderMfaSetup() {
  const card = renderMfaShell(
    'Protegé tu cuenta',
    'Para abrir el panel, configurá una app autenticadora como Google Authenticator, Microsoft Authenticator o 1Password.'
  );
  if (!state.mfaQrCode) {
    const form = element('form', 'mfa-form');
    const submit = element('button', 'primary-button', state.busy ? 'Preparando…' : 'Configurar segundo factor');
    submit.type = 'submit';
    submit.disabled = state.busy;
    form.append(submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.busy = true;
      setFeedback();
      renderMfaSetup();
      if (state.pendingMfaFactorId) {
        const { error } = await state.supabase.auth.mfa.unenroll({ factorId: state.pendingMfaFactorId });
        if (error) {
          state.busy = false;
          setFeedback(userFacingError(error, 'No pudimos reiniciar la configuración del segundo factor.'));
          renderMfaSetup();
          return;
        }
      }

      const { data, error } = await state.supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'UVR Home Soporte',
      });
      state.busy = false;
      if (error || !data?.totp?.qr_code || !data.totp.secret) {
        setFeedback(error
          ? userFacingError(error, 'No pudimos preparar el segundo factor. Probá de nuevo.')
          : 'No pudimos preparar el segundo factor. Probá de nuevo.');
        renderMfaSetup();
        return;
      }
      state.mfaFactorId = data.id;
      state.pendingMfaFactorId = null;
      state.mfaQrCode = data.totp.qr_code;
      state.mfaSecret = data.totp.secret;
      setFeedback();
      renderMfaSetup();
    });
    card.append(form);
    if (state.pendingMfaFactorId) {
      card.append(element('p', 'fine-print', 'Hay una configuración sin terminar. Al continuar, vamos a reiniciarla.'));
    }
    return;
  }

  const qr = document.createElement('img');
  qr.className = 'mfa-qr';
  qr.src = state.mfaQrCode;
  qr.alt = 'Código QR para configurar el autenticador';
  card.append(qr);
  card.append(element('p', 'muted', 'Escaneá el código con tu app autenticadora. Si no podés, cargá esta clave manualmente:'));
  const secret = element('code', 'mfa-secret', state.mfaSecret);
  card.append(secret);

  const form = element('form', 'mfa-form');
  const label = element('label', '', 'Código de 6 dígitos');
  const input = element('input', 'text-input mfa-code');
  input.type = 'text';
  input.name = 'code';
  input.inputMode = 'numeric';
  input.autoComplete = 'one-time-code';
  input.pattern = '[0-9]{6}';
  input.maxLength = 6;
  input.required = true;
  label.append(input);
  const submit = element('button', 'primary-button', state.busy ? 'Verificando…' : 'Verificar y activar');
  submit.type = 'submit';
  submit.disabled = state.busy;
  form.append(label, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await verifyMfa(state.mfaFactorId, new FormData(form).get('code')?.toString().trim(), true);
  });
  card.append(form);
  card.append(element('p', 'fine-print', 'No compartas la clave ni el código con nadie. UVR Home nunca te los va a pedir.'));
}

function renderMfaChallenge() {
  const card = renderMfaShell(
    'Verificá que sos vos',
    'Ingresá el código actual de tu app autenticadora para acceder al panel de soporte.'
  );
  const form = element('form', 'mfa-form');
  const label = element('label', '', 'Código de 6 dígitos');
  const input = element('input', 'text-input mfa-code');
  input.type = 'text';
  input.name = 'code';
  input.inputMode = 'numeric';
  input.autoComplete = 'one-time-code';
  input.pattern = '[0-9]{6}';
  input.maxLength = 6;
  input.required = true;
  label.append(input);
  const submit = element('button', 'primary-button', state.busy ? 'Verificando…' : 'Verificar');
  submit.type = 'submit';
  submit.disabled = state.busy;
  form.append(label, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await verifyMfa(state.mfaFactorId, new FormData(form).get('code')?.toString().trim(), false);
  });
  card.append(form);
  card.append(element('p', 'fine-print', 'Si perdiste acceso a tu autenticador, contactá a la persona propietaria para coordinar el restablecimiento del segundo factor.'));
}

async function verifyMfa(factorId, code, enrolling) {
  if (!factorId || !/^\d{6}$/.test(code || '')) {
    setFeedback('Ingresá el código de 6 dígitos de tu app autenticadora.');
    if (enrolling) renderMfaSetup();
    else renderMfaChallenge();
    return;
  }

  state.busy = true;
  setFeedback();
  if (enrolling) renderMfaSetup();
  else renderMfaChallenge();

  const { data: challenge, error: challengeError } = await state.supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge?.id) {
    state.busy = false;
    setFeedback(challengeError
      ? userFacingError(challengeError, 'No pudimos iniciar la verificación. Probá de nuevo.')
      : 'No pudimos iniciar la verificación. Probá de nuevo.');
    if (enrolling) renderMfaSetup();
    else renderMfaChallenge();
    return;
  }

  const { error } = await state.supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'El código no es válido o venció. Revisalo e intentá de nuevo.'));
    if (enrolling) renderMfaSetup();
    else renderMfaChallenge();
    return;
  }

  state.mfaQrCode = '';
  state.mfaSecret = '';
  state.pendingMfaFactorId = null;
  const { data } = await state.supabase.auth.getSession();
  state.session = data?.session ?? state.session;
  await boot();
}

function renderMfaFailure() {
  const card = renderMfaShell(
    'No pudimos verificar tu cuenta',
    'No vamos a mostrar tickets hasta confirmar tus permisos y el segundo factor.'
  );
  const retry = element('button', 'secondary-button', 'Reintentar');
  retry.addEventListener('click', boot);
  card.append(retry);
}

function renderAccessCheck() {
  state.tickets = [];
  state.messages = [];
  state.agents = [];
  state.dashboardStats = null;
  state.messageRequest += 1;
  state.ticketRequest += 1;
  state.agentRequest += 1;
  state.statsRequest += 1;
  app.replaceChildren(element('main', 'loading', 'Verificando permisos…'));
}

function renderTicketRow(ticket) {
  const button = element('button', `ticket-row${ticket.id === state.selectedId ? ' selected' : ''}`);
  button.type = 'button';
  button.dataset.ticketId = ticket.id;
  button.setAttribute('aria-pressed', ticket.id === state.selectedId ? 'true' : 'false');
  const body = element('span', 'ticket-row-body');
  const top = element('span', 'ticket-row-top');
  top.append(element('strong', 'ticket-client', ticket.client_name));
  top.append(element('time', 'ticket-row-time', formatAge(ticket.last_message_at)));
  body.append(top, element('span', 'ticket-subject', ticket.subject));
  const meta = element('span', 'ticket-row-meta');
  meta.append(element('span', `status status-${ticket.status}`, statusNames[ticket.status] || ticket.status));
  const urgency = ticketUrgency(ticket);
  if (urgency) meta.append(element('span', `urgency urgency-${urgency.level}`, urgency.label));
  meta.append(element('span', '', typeNames[ticket.ticket_type] || 'Ayuda'));
  if (state.role === 'owner') {
    const assignedAgent = state.agents.find((agent) => agent.user_id === ticket.assigned_agent_id);
    meta.append(element('span', 'ticket-row-agent', assignedAgent
      ? `${assignedAgent.email}${assignedAgent.removed_at ? ' · fuera del equipo' : ''}`
      : 'Sin asignar'));
  }
  body.append(meta);
  button.append(renderAvatar(ticket.client_name), body);
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
  const header = element('header', 'detail-bar');
  const backToList = element('button', 'detail-back', '‹');
  backToList.type = 'button';
  backToList.setAttribute('aria-label', 'Volver a la lista de tickets');
  backToList.addEventListener('click', closeTicket);
  const title = element('div', 'detail-title');
  const titleText = element('div', 'detail-title-text');
  titleText.append(element('h2', '', ticket.subject));
  titleText.append(element('p', 'ticket-context', `${ticket.client_name} · ${typeNames[ticket.ticket_type] || 'Ayuda'} · App ${ticket.app_version || '—'} · ${ticket.platform} · ${formatDate(ticket.created_at)}`));
  title.append(renderAvatar(ticket.client_name), titleText);
  const controls = element('div', 'ticket-controls');
  if (state.role === 'owner') {
    const assignment = document.createElement('select');
    assignment.className = 'status-select';
    assignment.setAttribute('aria-label', 'Agente asignado');
    const unassigned = document.createElement('option');
    unassigned.value = '';
    unassigned.textContent = 'Sin asignar';
    assignment.append(unassigned);
    state.agents
      .filter((agent) => agent.role === 'agent' && agent.active)
      .forEach((agent) => {
        const option = document.createElement('option');
        option.value = agent.user_id;
        option.textContent = agent.email;
        assignment.append(option);
      });
    const historicalAgent = state.agents.find((agent) => agent.user_id === ticket.assigned_agent_id && agent.removed_at);
    if (historicalAgent) {
      const option = document.createElement('option');
      option.value = historicalAgent.user_id;
      option.textContent = `${historicalAgent.email} · fuera del equipo`;
      option.disabled = true;
      assignment.append(option);
    }
    assignment.value = ticket.assigned_agent_id || '';
    assignment.disabled = state.busy;
    assignment.addEventListener('change', () => assignTicket(ticket.id, assignment.value || null));
    controls.append(assignment);
  }
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
  controls.append(status);
  header.append(backToList, title, controls);
  panel.append(header);

  const thread = element('div', 'thread');
  thread.dataset.ticketId = ticket.id;
  state.messages.forEach((message) => thread.append(renderMessage(message)));
  if (!state.messages.length) thread.append(element('p', 'muted thread-empty', 'Todavía no hay mensajes.'));
  panel.append(thread);

  const form = element('form', 'reply-form');
  const quick = element('div', 'quick-replies');
  quick.setAttribute('role', 'group');
  quick.setAttribute('aria-label', 'Respuestas rápidas');
  const aiButton = element('button', 'ai-button', '✨ Sugerir respuesta');
  aiButton.type = 'button';
  aiButton.disabled = state.busy;
  const aiStatus = element('span', 'ai-status', 'La IA arma un borrador para que lo revises. No se envía sola.');
  aiStatus.setAttribute('role', 'status');
  const textarea = document.createElement('textarea');
  textarea.className = 'text-input reply-input';
  textarea.name = 'reply';
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.required = true;
  textarea.placeholder = 'Escribile al usuario…';
  textarea.setAttribute('aria-label', 'Respuesta');
  textarea.value = state.drafts[ticket.id] || '';
  textarea.addEventListener('input', () => {
    if (textarea.value) state.drafts[ticket.id] = textarea.value;
    else delete state.drafts[ticket.id];
  });
  textarea.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  quickReplies.forEach(([name, text]) => {
    const chip = element('button', 'quick-reply', name);
    chip.type = 'button';
    chip.disabled = state.busy;
    chip.addEventListener('click', () => {
      const current = textarea.value.trim();
      textarea.value = current ? `${current}\n\n${text}` : text;
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    quick.append(chip);
  });
  aiButton.addEventListener('click', async () => {
    aiButton.disabled = true;
    aiButton.classList.add('is-thinking');
    aiButton.textContent = '✨ Pensando…';
    aiStatus.classList.remove('is-error');
    aiStatus.textContent = 'Leyendo la conversación…';
    const result = await requestAiDraft(ticket.id);
    aiButton.disabled = state.busy;
    aiButton.classList.remove('is-thinking');
    aiButton.textContent = '✨ Sugerir respuesta';
    if (result.error) {
      aiStatus.classList.add('is-error');
      aiStatus.textContent = result.error;
      return;
    }
    const current = (state.drafts[ticket.id] || '').trim();
    state.drafts[ticket.id] = current ? `${current}\n\n${result.draft}` : result.draft;
    if (textarea.isConnected) {
      textarea.value = state.drafts[ticket.id];
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      aiStatus.textContent = 'Borrador listo. Revisalo y completá lo que diga [completar] antes de enviar.';
    }
  });
  const bar = element('div', 'composer-bar');
  const send = element('button', 'primary-button send-button', state.busy ? 'Enviando…' : 'Enviar');
  send.type = 'submit';
  send.disabled = state.busy;
  bar.append(aiButton, aiStatus, send);
  const hint = element('span', 'fine-print reply-hint', 'Al responder, el ticket pasa a “Esperamos respuesta”. Ctrl + Enter para enviar.');
  form.append(quick, textarea, bar, hint);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendReply(ticket.id, new FormData(form).get('reply')?.toString().trim());
  });
  panel.append(form);
  return panel;
}

function renderAgentManagement(content) {
  const listedAgents = state.agents.filter((agent) => !agent.removed_at);
  const agents = listedAgents.filter((agent) => agent.role === 'agent');
  const activeAgents = agents.filter((agent) => agent.active);
  const availableAgents = activeAgents.filter((agent) => agent.available);
  const activeTickets = agents.reduce((total, agent) => total + (Number(agent.active_tickets) || 0), 0);

  const hero = element('section', 'team-hero');
  const introduction = element('div', 'team-hero-copy');
  introduction.append(
    element('p', 'eyebrow', 'ACCESO PRIVADO · SOLO PROPIETARIO'),
    element('h1', '', 'Un equipo que da confianza.'),
    element('p', '', 'Invitá a quienes van a estar del otro lado. Vos cuidás los accesos; el sistema reparte los tickets.')
  );
  const heroNote = element('div', 'team-hero-note');
  heroNote.append(
    element('span', '', 'UVR HOME · SOPORTE'),
    element('strong', '', 'Acceso protegido'),
    element('small', '', 'Segundo factor obligatorio')
  );
  hero.append(introduction, heroNote);
  content.append(hero);
  renderFeedback(content);

  const metrics = element('section', 'team-metrics');
  metrics.append(
    renderAgentMetric('Accesos activos', activeAgents.length, 'Personas habilitadas', 'team-metric-active'),
    renderAgentMetric('Disponibles', availableAgents.length, 'Pueden recibir tickets', 'team-metric-ready'),
    renderAgentMetric('En pausa', activeAgents.length - availableAgents.length, 'Sin nuevas asignaciones', 'team-metric-paused'),
    renderAgentMetric('Casos activos', activeTickets, 'Asignados al equipo', 'team-metric-tickets')
  );
  content.append(metrics);

  const invitePanel = element('section', 'invite-panel');
  const inviteIntro = element('div', 'invite-intro');
  inviteIntro.append(
    element('p', 'eyebrow', 'CRECÉ A TU RITMO'),
    element('h2', '', 'Sumá a alguien al equipo'),
    element('p', 'muted', 'Si ya tiene una cuenta de UVR Home, se habilita. Si todavía no, le mandamos una invitación.')
  );
  const form = element('form', 'invite-form');
  const label = element('label', '', 'Correo electrónico');
  const input = element('input', 'text-input');
  input.type = 'email';
  input.name = 'email';
  input.autoComplete = 'email';
  input.required = true;
  input.maxLength = 254;
  input.placeholder = 'agente@ejemplo.com';
  input.disabled = state.busy;
  label.append(input);
  const submit = element('button', 'primary-button', state.busy ? 'Procesando…' : 'Invitar agente');
  submit.type = 'submit';
  submit.disabled = state.busy;
  form.append(label, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = new FormData(form).get('email')?.toString().trim();
    if (!email) return;
    const userId = state.session?.user?.id;
    state.busy = true;
    setFeedback();
    renderDashboard();
    let result;
    let error;
    try {
      result = await state.supabase.functions.invoke('support-admin', {
        body: { action: 'invite_agent', email },
      });
      error = result.error;
    } catch (requestError) {
      error = requestError;
    }
    if (userId !== state.session?.user?.id) return;
    state.busy = false;
    if (error) {
      const detail = await supportFunctionError(error);
      setFeedback(userFacingError(detail, 'No pudimos enviar la invitación. Revisá el correo e intentá de nuevo.'));
      renderDashboard();
      return;
    }
    setFeedback(
      '',
      result.data?.registered
        ? `La cuenta de ${email} quedó habilitada. Pedile que solicite un enlace de acceso desde el portal y configure su segundo factor.`
        : `Invitación enviada a ${email}. Cuando acepte, tendrá que configurar su segundo factor.`
    );
    await Promise.all([loadAgents(), loadDashboardStats()]);
  });
  invitePanel.append(inviteIntro, form);
  content.append(invitePanel);

  const list = element('section', 'agent-list');
  const listHeading = element('div', 'team-list-heading');
  const listTitle = element('div', '');
  listTitle.append(
    element('h2', '', 'Personas con acceso'),
    element('p', 'muted', 'Gestioná el acceso y la disponibilidad sin perder el historial.')
  );
  listHeading.append(listTitle, element('span', 'team-count', `${listedAgents.length} ${listedAgents.length === 1 ? 'persona' : 'personas'}`));
  list.append(listHeading);
  listedAgents.forEach((agent) => {
    const owner = agent.role === 'owner';
    const row = element('article', `agent-card${owner ? ' is-owner' : ''}${!agent.active && !owner ? ' is-disabled' : ''}`);
    const identity = element('div', 'agent-card-identity');
    const initials = agent.email?.split('@')[0]?.slice(0, 2).toLocaleUpperCase('es-AR') || 'UV';
    identity.append(element('span', 'agent-card-avatar', initials));
    const details = element('div', 'agent-card-details');
    const name = element('strong', 'agent-email', owner ? `${agent.email} · Vos` : agent.email);
    const meta = element('div', 'agent-card-meta');
    meta.append(element('span', `agent-role${owner ? ' is-owner' : ''}`, owner ? 'Propietario' : 'Agente'));
    if (!owner) {
      const status = !agent.active ? 'Acceso deshabilitado' : agent.available ? 'Disponible' : 'En pausa';
      meta.append(element('span', `agent-state${!agent.active ? ' is-disabled' : agent.available ? ' is-available' : ' is-paused'}`, status));
    }
    details.append(name, meta);
    if (!owner) {
      const assigned = Number(agent.active_tickets) || 0;
      const total = Number(agent.total_tickets) || 0;
      details.append(element(
        'span',
        'agent-ticket-summary',
        `${assigned} ${assigned === 1 ? 'ticket activo' : 'tickets activos'} · ${total} asignados en total`
      ));
    } else {
      details.append(element('span', 'agent-ticket-summary', 'Tu cuenta de administración'));
    }
    identity.append(details);
    row.append(identity);
    if (agent.role === 'agent') {
      const actions = element('div', 'agent-actions');
      const toggle = element('button', agent.active ? 'secondary-button' : 'primary-button', agent.active ? 'Deshabilitar' : 'Rehabilitar');
      toggle.type = 'button';
      toggle.disabled = state.busy;
      toggle.setAttribute('aria-label', `${agent.active ? 'Deshabilitar' : 'Rehabilitar'} a ${agent.email}`);
      toggle.addEventListener('click', () => {
        if (agent.active) showAgentActionDialog(agent, 'disable');
        else void setAgentActive(agent, true);
      });
      const remove = element('button', 'danger-button', 'Quitar');
      remove.type = 'button';
      remove.disabled = state.busy;
      remove.setAttribute('aria-label', `Quitar a ${agent.email} del equipo`);
      remove.addEventListener('click', () => showAgentActionDialog(agent, 'remove'));
      actions.append(toggle, remove);
      row.append(actions);
    }
    list.append(row);
  });
  if (!agents.length) {
    const empty = element('div', 'team-empty');
    empty.append(
      element('span', 'team-empty-mark', '+'),
      element('strong', '', 'Tu equipo empieza acá'),
      element('p', 'muted', 'Cuando invites a alguien, vas a poder ver su disponibilidad y carga de trabajo en esta lista.')
    );
    list.append(empty);
  }
  content.append(list);
}

function renderAgentMetric(label, value, detail, accent) {
  const card = element('article', `team-metric ${accent}`);
  card.append(
    element('span', 'team-metric-label', label),
    element('strong', 'team-metric-value', Number(value || 0).toLocaleString('es-AR')),
    element('span', 'team-metric-detail', detail)
  );
  return card;
}

function showAgentActionDialog(agent, action) {
  const removing = action === 'remove';
  const activeTickets = Number(agent.active_tickets) || 0;
  const dialog = document.createElement('dialog');
  dialog.className = `confirm-dialog${removing ? ' is-danger' : ''}`;
  dialog.setAttribute('aria-labelledby', 'agent-dialog-title');
  dialog.setAttribute('aria-describedby', 'agent-dialog-description');

  const card = element('div', 'confirm-dialog-card');
  card.append(element('span', 'confirm-dialog-icon', removing ? '−' : 'Ⅱ'));
  card.append(element('h2', '', removing ? 'Quitar del equipo' : 'Deshabilitar acceso'));
  const title = card.querySelector('h2');
  title.id = 'agent-dialog-title';
  const description = element('p', 'muted', removing
    ? `Se va a quitar el acceso de ${agent.email} al panel. ${activeTickets
      ? `${activeTickets} ${activeTickets === 1 ? 'ticket activo va a quedar' : 'tickets activos van a quedar'} en la cola y se reasignarán si hay alguien disponible.`
      : 'No tiene tickets activos asignados.'} Su cuenta de UVR Home y todo el historial se conservan; podés volver a invitarlo más adelante.`
    : `${agent.email} va a perder el acceso al panel. ${activeTickets
      ? `${activeTickets} ${activeTickets === 1 ? 'ticket activo va a quedar' : 'tickets activos van a quedar'} en la cola y se reasignarán si hay alguien disponible.`
      : 'No tiene tickets activos asignados.'} Su cuenta y su historial no se borran.`);
  description.id = 'agent-dialog-description';
  card.append(description);

  const actions = element('div', 'confirm-dialog-actions');
  const cancel = element('button', 'secondary-button', 'Volver');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close('cancel'));
  const confirm = element('button', removing ? 'danger-button' : 'primary-button', removing ? 'Quitar del equipo' : 'Deshabilitar');
  confirm.type = 'button';
  confirm.addEventListener('click', () => dialog.close(action));
  actions.append(cancel, confirm);
  card.append(actions);
  dialog.append(card);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('cancel');
  });
  dialog.addEventListener('close', () => {
    const result = dialog.returnValue;
    dialog.remove();
    if (result === 'remove') void removeSupportAgent(agent);
    if (result === 'disable') void setAgentActive(agent, false);
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

async function supportFunctionError(error) {
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === 'string') return new Error(payload.error);
    } catch (parseError) {
      console.error('No pudimos interpretar el error de la función de soporte:', parseError);
    }
  }
  return error;
}

async function loadAgents() {
  if (!state.authorized || state.role !== 'owner') return;
  const requestId = ++state.agentRequest;
  const userId = state.session?.user?.id;
  const { data, error } = await state.supabase.rpc('list_support_agents');
  if (requestId !== state.agentRequest || userId !== state.session?.user?.id || !state.authorized) return;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos cargar el equipo de soporte. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  state.agents = data || [];
  renderDashboard();
}

async function setAgentActive(agent, active) {
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('set_support_agent_active', {
    p_user_id: agent.user_id,
    p_active: active,
  });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos actualizar el acceso. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  setFeedback('', active ? 'Agente habilitado.' : 'Agente deshabilitado y tickets liberados.');
  await Promise.all([loadAgents(), loadTickets(), loadDashboardStats()]);
}

async function removeSupportAgent(agent) {
  if (state.busy) return;
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('remove_support_agent', {
    p_user_id: agent.user_id,
  });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos quitar el acceso de soporte. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  setFeedback('', `Se quitó a ${agent.email} del equipo. La cuenta y el historial se conservaron.`);
  await Promise.all([loadAgents(), loadTickets(), loadDashboardStats()]);
}

async function assignTicket(ticketId, agentId) {
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('assign_support_ticket', {
    p_ticket_id: ticketId,
    p_agent_id: agentId,
  });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos asignar el ticket. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  setFeedback('', agentId ? 'Ticket asignado.' : 'Ticket devuelto a la cola para su reasignación.');
  await Promise.all([loadTickets(), loadAgents(), loadDashboardStats()]);
}

async function loadDashboardStats() {
  if (!state.authorized) return;
  const requestId = ++state.statsRequest;
  const userId = state.session?.user?.id;
  const { data, error } = await state.supabase.rpc('support_dashboard_stats');
  if (requestId !== state.statsRequest || userId !== state.session?.user?.id || !state.authorized) return;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos cargar las estadísticas. Probá de nuevo.'));
    state.dashboardStats = null;
    renderDashboard();
    return;
  }
  state.dashboardStats = data;
  renderDashboard();
}

function renderStatCard(label, value, detail, accent = '') {
  const card = element('article', `stat-card${accent ? ` ${accent}` : ''}`);
  card.append(element('span', 'stat-label', label));
  card.append(element('strong', 'stat-value', Number(value || 0).toLocaleString('es-AR')));
  card.append(element('span', 'stat-detail', detail));
  return card;
}

function renderDailyChart(days) {
  const chart = element('div', 'daily-chart');
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', 'Tickets nuevos por día en los últimos siete días');
  const points = Array.isArray(days) ? days : [];
  const max = Math.max(1, ...points.map((point) => Number(point.count) || 0));
  points.forEach((point) => {
    const column = element('div', 'chart-column');
    const value = Number(point.count) || 0;
    column.append(element('span', 'chart-value', String(value)));
    const track = element('div', 'chart-track');
    const bar = element('div', 'chart-bar');
    bar.style.height = `${value ? Math.max(8, value / max * 100) : 4}%`;
    track.append(bar);
    column.append(track);
    const date = new Date(`${point.day}T12:00:00`);
    const label = Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(date).replace('.', '');
    column.append(element('span', 'chart-day', label));
    chart.append(column);
  });
  if (!points.length) chart.append(element('p', 'empty', 'Todavía no hay actividad para mostrar.'));
  return chart;
}

function renderStatusBreakdown(stats) {
  const section = element('section', 'overview-card status-breakdown');
  section.append(element('h2', '', 'Estado de la bandeja'));
  section.append(element('p', 'muted', 'Cómo se distribuyen los tickets que tenés a la vista.'));
  const counts = stats.status_counts || {};
  const total = Number(stats.total) || 0;
  statuses.forEach(([status, label]) => {
    const row = element('div', 'status-breakdown-row');
    const heading = element('div', 'status-breakdown-heading');
    heading.append(
      element('span', '', label),
      element('strong', '', Number(counts[status] || 0).toLocaleString('es-AR'))
    );
    const track = element('div', 'status-breakdown-track');
    const bar = element('div', `status-breakdown-bar status-${status}`);
    bar.style.width = `${total ? Math.max(counts[status] ? 3 : 0, counts[status] / total * 100) : 0}%`;
    track.append(bar);
    row.append(heading, track);
    section.append(row);
  });
  return section;
}

function renderAgentWorkload(stats) {
  const section = element('section', 'overview-card workload-card');
  const heading = element('div', 'section-heading');
  const title = element('div', '');
  title.append(element('h2', '', 'Equipo y disponibilidad'));
  title.append(element('p', 'muted', 'Los tickets nuevos van primero a quien tenga menos casos activos.'));
  const agents = Array.isArray(stats.agents) ? stats.agents : [];
  const availableCount = agents.filter((agent) => agent.available).length;
  const badge = element('span', 'availability-summary', `${availableCount} de ${agents.length} disponibles`);
  heading.replaceChildren(title, badge);
  section.append(heading);
  if (!agents.length) {
    section.append(element('p', 'empty', 'Todavía no hay agentes habilitados.'));
    return section;
  }
  const list = element('div', 'workload-list');
  agents.forEach((agent) => {
    const row = element('div', 'workload-row');
    const identity = element('div', 'workload-identity');
    const initials = agent.email?.split('@')[0]?.slice(0, 2).toLocaleUpperCase('es-AR') || 'AG';
    const avatar = element('span', 'agent-avatar', initials);
    const details = element('div', 'workload-details');
    details.append(
      element('strong', '', agent.email || 'Agente'),
      element('span', 'muted', `${Number(agent.active_tickets) || 0} ${Number(agent.active_tickets) === 1 ? 'ticket activo' : 'tickets activos'}`)
    );
    identity.append(avatar, details);
    const status = element('span', `availability-pill ${agent.available ? 'is-available' : 'is-paused'}`, agent.available ? 'Disponible' : 'En pausa');
    row.append(identity, status);
    list.append(row);
  });
  section.append(list);
  return section;
}

function renderAgentAvailability(stats) {
  const available = stats.my_available === true;
  const card = element('section', `availability-card ${available ? 'is-available' : 'is-paused'}`);
  const copy = element('div', 'availability-copy');
  copy.append(
    element('span', 'eyebrow', 'TU DISPONIBILIDAD'),
    element('h2', '', available ? 'Estás en turno' : 'Estás en pausa'),
    element('p', 'muted', available
      ? 'Podés recibir tickets nuevos. El reparto prioriza a quien tenga menos casos activos.'
      : 'No te vamos a asignar tickets nuevos. Los que ya tenés siguen en tu bandeja.')
  );
  const button = element('button', available ? 'secondary-button' : 'primary-button', state.busy
    ? 'Actualizando…'
    : available ? 'Pausar asignaciones' : 'Ponerme disponible');
  button.type = 'button';
  button.disabled = state.busy;
  button.addEventListener('click', setMyAvailability);
  card.append(copy, button);
  return card;
}

function renderOverview(content) {
  const stats = state.dashboardStats;
  const hero = element('section', 'overview-hero');
  const introduction = element('div', 'overview-intro');
  introduction.append(
    element('p', 'eyebrow', state.role === 'owner' ? 'PANEL DE CONTROL' : 'TU ESPACIO DE SOPORTE'),
    element('h1', '', state.role === 'owner' ? 'Resumen general' : 'Tu resumen'),
    element('p', 'overview-subtitle', state.role === 'owner'
      ? 'Una vista clara de la bandeja, el equipo y lo que necesita atención.'
      : 'Tus casos asignados y la actividad reciente, en un solo lugar.')
  );
  const refresh = element('button', 'overview-refresh', '↻  Actualizar');
  refresh.type = 'button';
  refresh.disabled = state.busy;
  refresh.addEventListener('click', refreshDashboard);
  hero.append(introduction, refresh);
  content.append(hero);
  renderFeedback(content);

  if (!stats) {
    content.append(element('div', 'overview-loading', 'Cargando tus estadísticas…'));
    return;
  }

  const activeTickets = Number(stats.active) || 0;
  const metrics = element('section', 'overview-metrics');
  metrics.append(
    renderStatCard('Tickets en tu bandeja', stats.total, `${Number(stats.created_today) || 0} nuevos hoy`, 'stat-total'),
    renderStatCard('Requieren atención', activeTickets, `${Number(stats.open) || 0} sin revisar`, 'stat-active'),
    renderStatCard('Esperando respuesta', stats.waiting_on_user, 'Pendientes del usuario', 'stat-waiting'),
    renderStatCard('Nuevos en 7 días', stats.created_last_7_days, 'Última semana', 'stat-new')
  );
  if (state.role === 'owner') {
    metrics.append(renderStatCard('Sin asignar', stats.unassigned, 'En la cola general', 'stat-unassigned'));
  }
  content.append(metrics);

  if (state.role === 'agent') content.append(renderAgentAvailability(stats));

  const charts = element('div', 'overview-grid');
  const volume = element('section', 'overview-card volume-card');
  const volumeHeading = element('div', 'section-heading');
  const volumeTitle = element('div', '');
  volumeTitle.append(element('h2', '', 'Ritmo de tickets'));
  volumeTitle.append(element('p', 'muted', 'Tickets creados durante los últimos 7 días.'));
  volumeHeading.append(volumeTitle, element('span', 'chart-period', '7 DÍAS'));
  volume.append(volumeHeading, renderDailyChart(stats.daily));
  charts.append(volume, renderStatusBreakdown(stats));
  content.append(charts);

  if (state.role === 'owner') content.append(renderAgentWorkload(stats));

  const recent = element('section', 'overview-card recent-card');
  const recentHeading = element('div', 'section-heading');
  const recentTitle = element('div', '');
  recentTitle.append(element('h2', '', 'Actividad reciente'));
  recentTitle.append(element('p', 'muted', 'Los últimos tickets recibidos en la bandeja.'));
  recentHeading.append(recentTitle);
  const allTickets = element('button', 'text-button', 'Ver todos');
  allTickets.type = 'button';
  allTickets.addEventListener('click', () => navigateTo('tickets'));
  recentHeading.append(allTickets);
  recent.append(recentHeading);
  if (state.tickets.length) {
    state.tickets.slice(0, 5).forEach((ticket) => recent.append(renderTicketRow(ticket)));
  } else {
    recent.append(element('p', 'empty', 'Todavía no hay tickets para mostrar.'));
  }
  content.append(recent);
}

async function setMyAvailability() {
  const available = state.dashboardStats?.my_available !== true;
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('set_support_agent_availability', { p_available: available });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos cambiar tu disponibilidad. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  setFeedback('', available
    ? 'Quedaste disponible. Si había tickets en espera, el sistema los va a repartir.'
    : 'Quedaste en pausa. Tus tickets actuales siguen asignados a vos.');
  await Promise.all([loadDashboardStats(), loadTickets()]);
}

async function refreshDashboard() {
  const requests = [loadDashboardStats(), loadTickets()];
  if (state.role === 'owner') requests.push(loadAgents());
  await Promise.all(requests);
}

function routeFromHash() {
  const match = /^#\/(tickets|agents)(?:\/([0-9a-f-]{36}))?$/i.exec(window.location.hash);
  if (!match) return { page: 'overview', ticketId: null };
  return { page: match[1].toLowerCase(), ticketId: match[2] || null };
}

function routeHash() {
  if (state.page === 'tickets') return state.selectedId ? `#/tickets/${state.selectedId}` : '#/tickets';
  return state.page === 'agents' ? '#/agents' : '#/';
}

function syncRoute({ replace = false } = {}) {
  const hash = routeHash();
  if (window.location.hash === hash || (hash === '#/' && !window.location.hash)) return;
  const target = `${window.location.pathname}${window.location.search}${hash}`;
  const from = routeFromHash();
  const openingFromList = from.page === 'tickets' && !from.ticketId && hash.startsWith('#/tickets/');
  const switchingTicket = from.page === 'tickets' && Boolean(from.ticketId) && hash.startsWith('#/tickets/');
  if (replace || switchingTicket) window.history.replaceState(window.history.state, '', target);
  else window.history.pushState(openingFromList ? { fromList: true } : null, '', target);
}

function closeTicket() {
  state.messageRequest += 1;
  // Si el ticket se abrió desde la lista, volvemos en el historial para que "atrás" no lo reabra.
  if (window.history.state?.fromList) {
    window.history.back();
    return;
  }
  state.selectedId = null;
  state.messages = [];
  syncRoute({ replace: true });
  renderDashboard();
}

function applyRoute({ restoring = false } = {}) {
  const route = routeFromHash();
  state.page = route.page;
  state.selectedId = route.ticketId;
  // A ticket opened by link may not match the default "Abiertos" filter.
  if (restoring && route.ticketId) state.filter = 'all';
}

function navigateTo(page) {
  state.page = page;
  if (page === 'tickets') {
    state.unseenTickets = 0;
    updateDocumentTitle();
  }
  syncRoute();
  renderDashboard();
  app.querySelector('.dashboard-main')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  if (!state.authorized) return;
  applyRoute();
  if (state.role !== 'owner' && state.page === 'agents') state.page = 'overview';
  state.messages = [];
  renderDashboard();
  if (state.page === 'tickets' && state.selectedId) void loadMessages(state.selectedId);
});

function renderDashboard() {
  if (!state.authorized) return renderUnauthorized();
  const shell = element('div', state.page === 'tickets' ? 'dashboard is-inbox' : 'dashboard');
  const header = element('header', 'app-header');
  const brand = element('div', 'header-brand');
  brand.append(element('div', 'brand-mark small-mark', 'UVR'));
  const brandText = element('div', '');
  brandText.append(element('strong', '', 'UVR Home'), element('span', 'muted', 'Soporte'));
  brand.append(brandText);
  const account = element('div', 'header-account');
  account.append(element('span', 'muted account-email', state.session?.user?.email || 'Agente'));
  const nav = element('nav', 'header-nav');
  const overview = element('button', state.page === 'overview' ? 'nav-button active' : 'nav-button', 'Resumen');
  overview.type = 'button';
  if (state.page === 'overview') overview.setAttribute('aria-current', 'page');
  overview.addEventListener('click', () => navigateTo('overview'));
  nav.append(overview);
  const tickets = element('button', state.page === 'tickets' ? 'nav-button active' : 'nav-button', 'Tickets');
  tickets.type = 'button';
  const openCount = Number(state.dashboardStats?.open || 0);
  if (openCount) {
    tickets.append(element('span', 'nav-badge', openCount > 99 ? '99+' : String(openCount)));
    tickets.setAttribute('aria-label', `Tickets, ${openCount} ${openCount === 1 ? 'abierto' : 'abiertos'}`);
  }
  if (state.page === 'tickets') tickets.setAttribute('aria-current', 'page');
  tickets.addEventListener('click', () => navigateTo('tickets'));
  nav.append(tickets);
  if (state.role === 'owner') {
    const agents = element('button', state.page === 'agents' ? 'nav-button active' : 'nav-button', 'Usuarios');
    agents.type = 'button';
    if (state.page === 'agents') agents.setAttribute('aria-current', 'page');
    agents.addEventListener('click', () => navigateTo('agents'));
    nav.append(agents);
  }
  header.append(brand, nav);
  const logout = element('button', 'text-button', 'Salir');
  logout.addEventListener('click', signOut);
  account.append(logout);
  header.append(account);
  shell.append(header);

  const content = element('main', 'dashboard-main');
  content.tabIndex = -1;
  if (state.role === 'owner' && state.page === 'agents') {
    renderAgentManagement(content);
    shell.append(content);
    app.replaceChildren(shell);
    return;
  }
  if (state.page === 'overview') {
    renderOverview(content);
    shell.append(content);
    app.replaceChildren(shell);
    return;
  }
  content.classList.add('is-inbox');
  content.append(element('h1', 'sr-only', 'Tickets'));
  renderFeedback(content);

  const columns = element('div', 'dashboard-columns');
  const listPanel = element('aside', 'list-panel');
  const tools = element('div', 'list-tools');
  const searchRow = element('div', 'search-row');
  const search = document.createElement('input');
  search.className = 'text-input ticket-search';
  search.type = 'search';
  search.name = 'ticket-search';
  search.autocomplete = 'off';
  search.placeholder = 'Buscar por asunto o cliente';
  search.setAttribute('aria-label', 'Buscar tickets');
  search.value = state.ticketSearch;
  search.addEventListener('input', () => {
    state.ticketSearch = search.value;
    renderTicketResults(list, listHeading);
  });
  const refresh = element('button', 'icon-button', '↻');
  refresh.type = 'button';
  refresh.setAttribute('aria-label', 'Actualizar tickets');
  refresh.title = 'Actualizar';
  refresh.addEventListener('click', loadTickets);
  searchRow.append(search, refresh);

  const pills = element('div', 'filter-pills');
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Filtrar por estado');
  const pillOptions = [...ticketFilters];
  if (state.role === 'owner') pillOptions.push(['unassigned', 'Sin asignar']);
  pillOptions.push(['all', 'Todos']);
  pillOptions.forEach(([value, label]) => {
    const count = value === 'all'
      ? state.tickets.length
      : state.tickets.filter((ticket) => (value === 'unassigned' ? !ticket.assigned_agent_id : ticket.status === value)).length;
    const pill = element('button', 'pill', label);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', state.filter === value ? 'true' : 'false');
    if (count) pill.append(element('span', 'pill-count', String(count)));
    pill.addEventListener('click', () => {
      state.filter = value;
      renderDashboard();
    });
    pills.append(pill);
  });
  tools.append(searchRow, pills);

  const list = element('div', 'ticket-list');
  list.setAttribute('aria-label', 'Bandeja de tickets');
  const listHeading = element('div', 'list-heading');
  listHeading.setAttribute('aria-live', 'polite');
  listHeading.setAttribute('aria-atomic', 'true');
  renderTicketResults(list, listHeading);
  listPanel.append(tools, list);
  columns.append(listPanel);

  const selected = state.tickets.find((ticket) => ticket.id === state.selectedId);
  if (selected) {
    shell.classList.add('has-ticket');
    columns.append(renderDetail(selected));
  } else {
    const empty = element('section', 'detail-empty');
    empty.append(element('div', 'empty-icon', '✓'), element('h2', '', 'Elegí un ticket'));
    empty.append(element('p', 'muted', 'Las consultas y reportes de errores van a aparecer acá.'));
    columns.append(empty);
  }
  content.append(columns);
  shell.append(content);
  const previousThread = app.querySelector('.thread');
  const previousList = app.querySelector('.ticket-list');
  const threadMemory = previousThread && {
    ticketId: previousThread.dataset.ticketId,
    top: previousThread.scrollTop,
    atBottom: previousThread.scrollHeight - previousThread.scrollTop - previousThread.clientHeight < 48,
  };
  const listTop = previousList?.scrollTop || 0;
  app.replaceChildren(shell);
  list.scrollTop = listTop;
  const thread = app.querySelector('.thread');
  if (thread) {
    thread.scrollTop = threadMemory && threadMemory.ticketId === thread.dataset.ticketId && !threadMemory.atBottom
      ? threadMemory.top
      : thread.scrollHeight;
  }
}

function renderTicketResults(list, heading) {
  const query = state.ticketSearch.trim().toLocaleLowerCase('es-AR');
  const visible = state.tickets.filter((ticket) => {
    const matchesFilter = state.filter === 'all'
      || (state.filter === 'unassigned' && !ticket.assigned_agent_id)
      || ticket.status === state.filter;
    if (!matchesFilter || !query) return matchesFilter;
    const assignedAgent = state.agents.find((agent) => agent.user_id === ticket.assigned_agent_id);
    const searchable = [
      ticket.subject,
      ticket.client_name,
      typeNames[ticket.ticket_type],
      ticket.platform,
      ticket.app_version,
      ticket.id,
      state.role === 'owner' ? assignedAgent?.email : '',
    ].filter(Boolean).join(' ').toLocaleLowerCase('es-AR');
    return searchable.includes(query);
  });
  const sorted = sortTickets(visible);
  const lateCount = visible.filter((ticket) => ticketUrgency(ticket)).length;
  heading.replaceChildren(element('span', '', `${visible.length} ${visible.length === 1 ? 'ticket' : 'tickets'}`));
  if (lateCount) heading.append(element('span', 'urgency urgency-late', `${lateCount} con demora`));
  const sortLabel = sortOptions.find(([value]) => value === state.ticketSort)?.[1] || '';
  const sortButton = element('button', 'sort-button', `${sortLabel} ▾`);
  sortButton.type = 'button';
  sortButton.setAttribute('aria-label', `Orden: ${sortLabel}. Tocá para cambiar.`);
  sortButton.addEventListener('click', () => {
    state.ticketSort = state.ticketSort === 'urgent' ? 'recent' : 'urgent';
    renderTicketResults(list, heading);
  });
  heading.append(sortButton);
  list.replaceChildren(heading);
  if (!visible.length) {
    const emptyList = element('div', 'ticket-empty');
    const emptyMessage = state.tickets.length
      ? query
        ? 'No encontramos tickets que coincidan con tu búsqueda y filtro.'
        : 'No hay tickets con este filtro.'
      : 'Cuando llegue una consulta, la vas a encontrar acá.';
    emptyList.append(element('span', 'ticket-empty-mark', '—'), element('p', 'empty', emptyMessage));
    list.append(emptyList);
  } else {
    sorted.forEach((ticket) => list.append(renderTicketRow(ticket)));
  }
  if (state.tickets.length < state.ticketTotal) {
    const more = element('div', 'load-more');
    more.append(element('span', 'fine-print', `Mostrando ${state.tickets.length} de ${state.ticketTotal} tickets${query || state.filter !== 'all' ? ' · filtros y búsqueda aplican a los cargados' : ''}`));
    const button = element('button', 'secondary-button', state.loadingMore ? 'Cargando…' : 'Cargar más');
    button.type = 'button';
    button.disabled = state.loadingMore;
    button.addEventListener('click', loadMoreTickets);
    more.append(button);
    list.append(more);
  }
}

async function fetchTicketPage(limit) {
  return state.supabase
    .from('support_tickets')
    .select('id, user_id, assigned_agent_id, client_name, ticket_type, subject, status, app_version, platform, created_at, updated_at, last_message_at', { count: 'exact' })
    .order('last_message_at', { ascending: false })
    .range(0, limit - 1);
}

async function loadTickets() {
  if (!state.authorized) return;
  const requestId = ++state.ticketRequest;
  const userId = state.session?.user?.id;
  const { data, count, error } = await fetchTicketPage(state.ticketLimit);
  if (requestId !== state.ticketRequest || userId !== state.session?.user?.id || !state.authorized) return;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos cargar los tickets. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  state.tickets = data || [];
  state.ticketTotal = count ?? state.tickets.length;
  state.ticketsLoaded = true;
  if (state.selectedId && !state.tickets.some((ticket) => ticket.id === state.selectedId)) {
    state.selectedId = null;
    syncRoute({ replace: true });
  }
  renderDashboard();
}

async function loadMoreTickets() {
  if (state.loadingMore) return;
  state.loadingMore = true;
  state.ticketLimit += TICKET_PAGE_SIZE;
  renderDashboard();
  try {
    await loadTickets();
  } finally {
    state.loadingMore = false;
    if (state.authorized) renderDashboard();
  }
}

function isTypingInApp() {
  const active = document.activeElement;
  return Boolean(active && app.contains(active) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName));
}

async function pollSupport() {
  if (!state.authorized || state.polling || state.busy || document.hidden || state.page === 'agents') return;
  state.polling = true;
  const userId = state.session?.user?.id;
  const previous = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  const previousLatest = state.tickets.reduce((latest, ticket) => Math.max(latest, new Date(ticket.created_at).getTime()), 0);
  try {
    const [page, stats] = await Promise.all([
      fetchTicketPage(state.ticketLimit),
      state.supabase.rpc('support_dashboard_stats'),
    ]);
    if (userId !== state.session?.user?.id || !state.authorized || state.busy) return;
    if (page.error) return;
    const tickets = page.data || [];
    if (!stats.error) state.dashboardStats = stats.data;
    const fresh = state.ticketsLoaded
      ? tickets.filter((ticket) => !previous.has(ticket.id)
        && (state.role === 'agent' || new Date(ticket.created_at).getTime() > previousLatest))
      : [];
    const replies = state.ticketsLoaded
      ? tickets.filter((ticket) => {
        const before = previous.get(ticket.id);
        return before && ticket.status === 'open' && before.last_message_at !== ticket.last_message_at;
      })
      : [];
    const selectedChanged = Boolean(state.selectedId) && tickets.some((ticket) => ticket.id === state.selectedId
      && previous.get(ticket.id)?.last_message_at !== ticket.last_message_at);
    state.tickets = tickets;
    state.ticketTotal = page.count ?? tickets.length;
    state.ticketsLoaded = true;
    if (state.selectedId && !tickets.some((ticket) => ticket.id === state.selectedId)) state.selectedId = null;
    if (selectedChanged) {
      const { data: messages, error } = await state.supabase
        .from('support_ticket_messages')
        .select('id, author_role, body, created_at')
        .eq('ticket_id', state.selectedId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (!error && userId === state.session?.user?.id) state.messages = messages || [];
    }
    if (fresh.length || replies.length) {
      state.unseenTickets += fresh.length + replies.length;
      updateDocumentTitle();
      const parts = [];
      if (fresh.length) parts.push(`${fresh.length} ${fresh.length === 1 ? 'ticket nuevo' : 'tickets nuevos'}`);
      if (replies.length) parts.push(`${replies.length} ${replies.length === 1 ? 'respuesta de usuario' : 'respuestas de usuarios'}`);
      showToast(parts.join(' · '), state.page === 'tickets' ? '' : 'Ver tickets', () => {
        state.filter = 'open';
        state.ticketSort = 'urgent';
        navigateTo('tickets');
      });
    }
    const list = app.querySelector('.ticket-list');
    if (isTypingInApp() && list && state.page === 'tickets') {
      renderTicketResults(list, list.querySelector('.list-heading') || element('div', 'list-heading'));
    } else if (!isTypingInApp()) {
      renderDashboard();
    }
  } finally {
    state.polling = false;
  }
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = window.setInterval(() => void pollSupport(), POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.unseenTickets = 0;
  updateDocumentTitle();
}

function resetTicketView() {
  stopPolling();
  state.ticketSort = 'recent';
  state.ticketLimit = TICKET_PAGE_SIZE;
  state.ticketTotal = 0;
  state.ticketsLoaded = false;
  state.loadingMore = false;
  state.drafts = {};
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void pollSupport();
});

async function loadMessages(ticketId) {
  if (!state.authorized) return;
  const requestId = ++state.messageRequest;
  const userId = state.session?.user?.id;
  const { data, error } = await state.supabase
    .from('support_ticket_messages')
    .select('id, author_role, body, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (
    state.selectedId !== ticketId
    || requestId !== state.messageRequest
    || userId !== state.session?.user?.id
    || !state.authorized
  ) return;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos cargar los mensajes. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  state.messages = data || [];
  renderDashboard();
}

async function selectTicket(ticketId) {
  const pageChanged = state.page !== 'tickets';
  state.selectedId = ticketId;
  state.page = 'tickets';
  syncRoute();
  state.unseenTickets = 0;
  updateDocumentTitle();
  state.messages = [];
  renderDashboard();
  if (pageChanged) {
    app.querySelector('.dashboard-main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  await loadMessages(ticketId);
}

async function requestAiDraft(ticketId) {
  const userId = state.session?.user?.id;
  let result;
  let error;
  try {
    result = await state.supabase.functions.invoke('support-draft', { body: { ticket_id: ticketId } });
    error = result.error;
  } catch (requestError) {
    error = requestError;
  }
  if (error) {
    const detail = await supportFunctionError(error);
    return { error: userFacingError(detail, 'No pudimos armar el borrador. Podés responder a mano.') };
  }
  if (userId !== state.session?.user?.id || typeof result.data?.draft !== 'string') {
    return { error: 'No pudimos armar el borrador. Podés responder a mano.' };
  }
  return { draft: result.data.draft.replace(/[ \t]+\n/g, '\n').replace(/^(\S[^\n]{0,30},)\n+/, '$1 ').trim() };
}

async function sendReply(ticketId, body) {
  if (!body) return;
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('reply_support_ticket', {
    p_ticket_id: ticketId,
    p_message: body,
  });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos enviar la respuesta. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  setFeedback('', 'Respuesta enviada.');
  delete state.drafts[ticketId];
  await Promise.all([loadTickets(), loadMessages(ticketId), loadDashboardStats()]);
}

async function updateStatus(ticketId, status) {
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('set_support_ticket_status', {
    p_ticket_id: ticketId,
    p_status: status,
  });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) setFeedback(userFacingError(error, 'No pudimos actualizar el estado. Probá de nuevo.'));
  else setFeedback('', 'Estado actualizado.');
  await Promise.all([loadTickets(), loadDashboardStats()]);
}

async function signOut() {
  const { error } = await state.supabase.auth.signOut();
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos cerrar la sesión. Probá de nuevo.'));
    if (state.authorized) renderDashboard();
    else renderUnauthorized();
    return;
  }
  state.session = null;
  state.role = null;
  state.authorized = false;
  state.tickets = [];
  state.messages = [];
  state.agents = [];
  state.dashboardStats = null;
  state.selectedId = null;
  state.messageRequest += 1;
  state.ticketRequest += 1;
  state.agentRequest += 1;
  state.statsRequest += 1;
  state.busy = false;
  state.error = '';
  state.notice = '';
  state.ticketSearch = '';
  resetTicketView();
  state.bootRequest += 1;
  renderLogin();
}

async function boot() {
  const requestId = ++state.bootRequest;
  if (!state.session) {
    state.role = null;
    state.authorized = false;
    state.tickets = [];
    state.messages = [];
    state.agents = [];
    state.dashboardStats = null;
    state.messageRequest += 1;
    state.ticketRequest += 1;
    state.agentRequest += 1;
    state.statsRequest += 1;
    stopPolling();
    renderLogin();
    return;
  }
  if (state.authorized) renderAccessCheck();
  state.authorized = false;
  const { data: role, error } = await state.supabase.rpc('support_account_role');
  if (requestId !== state.bootRequest) return;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos validar los permisos de tu cuenta. Probá de nuevo.'));
    renderUnauthorized();
    return;
  }
  state.role = role;
  if (role !== 'owner' && role !== 'agent') {
    renderUnauthorized();
    return;
  }

  const { data: assurance, error: assuranceError } = await state.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (requestId !== state.bootRequest) return;
  if (assuranceError) {
    setFeedback(userFacingError(assuranceError, 'No pudimos verificar el segundo factor. Probá de nuevo.'));
    renderMfaFailure();
    return;
  }
  if (assurance?.currentLevel === 'aal2' && assurance.nextLevel !== 'aal2') {
    setFeedback('Cambió la configuración del segundo factor. Iniciá sesión de nuevo para volver a verificarla.');
    const { error: signOutError } = await state.supabase.auth.signOut();
    if (signOutError) {
      setFeedback(userFacingError(signOutError, 'No pudimos cerrar la sesión. Cerrá el portal e iniciá sesión de nuevo.'));
      renderMfaFailure();
      return;
    }
    state.session = null;
    state.role = null;
    renderLogin();
    return;
  }
  if (assurance?.currentLevel !== 'aal2') {
    const { data: factors, error: factorsError } = await state.supabase.auth.mfa.listFactors();
    if (requestId !== state.bootRequest) return;
    if (factorsError) {
      setFeedback(userFacingError(factorsError, 'No pudimos consultar tu segundo factor. Probá de nuevo.'));
      renderMfaFailure();
      return;
    }

    const verified = factors?.totp?.find((factor) => factor.status === 'verified');
    state.pendingMfaFactorId = factors?.totp?.find((factor) => factor.status === 'unverified')?.id ?? null;
    state.mfaQrCode = '';
    state.mfaSecret = '';
    state.authorized = false;
    if (verified) {
      state.mfaFactorId = verified.id;
      renderMfaChallenge();
    } else {
      state.mfaFactorId = null;
      renderMfaSetup();
    }
    return;
  }

  state.mfaFactorId = null;
  state.pendingMfaFactorId = null;
  state.authorized = true;
  if (state.role !== 'owner' && state.page === 'agents') state.page = 'overview';
  syncRoute({ replace: true });
  startPolling();
  const dashboardRequests = [loadDashboardStats()];
  if (state.role === 'owner') dashboardRequests.push(loadAgents());
  else state.agents = [];
  await Promise.all(dashboardRequests);
  if (requestId !== state.bootRequest) return;
  if (state.page === 'agents') return;
  await loadTickets();
  if (requestId !== state.bootRequest) return;
  if (state.page === 'tickets' && state.selectedId && !state.messages.length) await loadMessages(state.selectedId);
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
    const previousUserId = state.session?.user?.id;
    if (previousUserId !== session?.user?.id) {
      state.role = null;
      state.authorized = false;
      state.tickets = [];
      state.messages = [];
      state.agents = [];
      state.dashboardStats = null;
      state.selectedId = null;
      state.messageRequest += 1;
      state.ticketRequest += 1;
      state.agentRequest += 1;
      state.statsRequest += 1;
      state.busy = false;
      state.error = '';
      state.notice = '';
      state.filter = 'open';
      state.ticketSearch = '';
      state.page = 'overview';
      resetTicketView();
      // Restore the route only when the page loads with a saved session, not when another person signs in.
      if (!previousUserId && session) applyRoute({ restoring: true });
      else if (window.location.hash.startsWith('#/')) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    const sameUser = Boolean(session) && previousUserId === session.user?.id;
    state.session = session;
    // Token refreshes and tab-focus events must not rebuild an already open dashboard.
    if (sameUser && state.authorized) return;
    window.setTimeout(() => void boot(), 0);
  });
  state.supabase.auth.getSession().then(({ data, error }) => {
    if (error) setFeedback(userFacingError(error, 'No pudimos recuperar la sesión. Iniciá sesión de nuevo.'));
    state.session = data?.session ?? null;
    void boot();
  });
}
