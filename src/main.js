import { createClient } from '@supabase/supabase-js';
import '@fontsource-variable/inter';
import './style.css';
import './theme-dark.css';
import { icon } from './icons.js';
import { closePalette, isPaletteOpen, openPalette } from './palette.js';
import { createLiveChannel } from './realtime.js';
import {
  disableNotify,
  dismissNotifyOffer,
  enableNotify,
  isPortalInView,
  loadNotifyPrefs,
  notifyStatus,
  resumeNotify,
  shouldOfferNotify,
  showDesktopNotice,
  snoozedUntil,
  snoozeNotify,
} from './notify.js';

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
// Con el canal en vivo conectado, el sondeo queda como red de seguridad.
const LIVE_FALLBACK_MS = 120000;
// Sin teclear durante este tiempo, el resto del equipo deja de ver "está escribiendo".
const TYPING_IDLE_MS = 4000;
const HOUR_MS = 3600000;
const AVATAR_SIZE = 320;
const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
const AVATAR_URL_TTL_SECONDS = 3600;
const AVATAR_URL_REFRESH_MS = 40 * 60000;
// Horas sin respuesta del equipo antes de marcar un ticket como "con demora" o "urgente".
const responseLimits = {
  open: { late: 4, urgent: 24 },
  in_progress: { late: 24, urgent: 48 },
};
// [nombre, texto, atajo]. Se insertan con "/atajo" en el compositor; {nombre} y {agente} se completan solos.
const quickReplies = [
  ['Recibimos tu consulta', '¡Hola, {nombre}! Gracias por escribirnos. Ya estamos revisando tu consulta y te respondemos a la brevedad.', 'hola'],
  ['Presentarme', 'Hola, {nombre}. Soy {agente}, del equipo de UVR Home, y voy a seguir tu caso hasta que quede resuelto.', 'soy'],
  ['Pedir más datos', 'Para ayudarte mejor, ¿podés contarnos qué pasos seguiste, qué esperabas que pasara y qué ves en pantalla? Si tenés una captura, mejor.', 'datos'],
  ['Actualizar la app', 'Probá actualizar la app a la última versión desde la tienda y volvé a intentar. Si el problema sigue, contanos y lo revisamos.', 'actualizar'],
  ['Reiniciar la app', 'Cerrá la app por completo, volvé a abrirla y probá de nuevo. Si no se soluciona, avisanos y seguimos con el caso.', 'reiniciar'],
  ['Resuelto', '¡Listo, {nombre}! Dejamos resuelto el problema. Si algo más falla, respondé este mensaje y lo vemos.', 'resuelto'],
  ['Cierre por falta de respuesta', 'Como no tuvimos novedades, vamos a dar el ticket por resuelto. Si todavía lo necesitás, escribinos y lo reabrimos.', 'cierre'],
];
const UNDO_SEND_MS = 5000;
const ATTACH_BUCKET = 'support-attachments';
const ATTACH_MAX_FILES = 6;
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_MAX_SIDE = 1600;
const ATTACH_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ATTACH_URL_TTL_SECONDS = 3600;
const ATTACH_URL_REFRESH_MS = 50 * 60000;
const DRAFTS_KEY = 'uvr.support.drafts';
const FILL_IN = '[completar]';
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
const DETAILS_PREF = 'uvr.support.showDetails';
// En pantallas angostas los detalles son un cajón flotante: arranca cerrado y no pisa la preferencia de escritorio.
const isWideDetails = () => window.matchMedia('(min-width: 1280px)').matches;
const readDetailsPref = () => {
  if (!isWideDetails()) return false;
  try {
    const saved = localStorage.getItem(DETAILS_PREF);
    if (saved !== null) return saved !== '0';
  } catch { /* Sin almacenamiento: se usa el valor por defecto. */ }
  return true;
};
const state = {
  supabase: null,
  session: null,
  role: null,
  authorized: false,
  tickets: [],
  messages: [],
  agents: [],
  profile: null,
  team: {},
  avatarUrls: {},
  avatarUrlsAt: 0,
  clientContexts: {},
  profileSaving: false,
  dashboardStats: null,
  selectedId: null,
  filter: 'open',
  showDetails: readDetailsPref(),
  quickMenuOpen: false,
  ticketSearch: '',
  ticketSort: 'recent',
  ticketLimit: TICKET_PAGE_SIZE,
  ticketTotal: 0,
  ticketsLoaded: false,
  loadingMore: false,
  drafts: {},
  activity: [],
  threadFor: null,
  threadError: null,
  ticketsFailed: false,
  composerMode: 'reply',
  noteDrafts: {},
  threadView: 'all',
  pendingSend: null,
  delivering: [],
  uploads: {},
  attachUrls: {},
  unseenTickets: 0,
  pollTimer: null,
  polling: false,
  pollQueued: false,
  lastPollAt: 0,
  live: null,
  liveOk: false,
  viewers: {},
  typing: {},
  mentionsSince: null,
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

const THEME_KEY = 'uvr-support-theme';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let sessionTheme = null;

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'dark' || value === 'light' ? value : sessionTheme;
  } catch {
    return sessionTheme;
  }
}

function currentTheme() {
  return savedTheme() || (systemDark.matches ? 'dark' : 'light');
}

function applyTheme() {
  document.documentElement.dataset.theme = currentTheme();
}

function toggleTheme() {
  sessionTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, sessionTheme);
  } catch {
    // Sin localStorage el cambio dura hasta recargar.
  }
  const swap = () => {
    applyTheme();
    if (state.authorized) renderDashboard();
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(swap);
  else swap();
}

applyTheme();
systemDark.addEventListener('change', () => {
  if (savedTheme()) return;
  applyTheme();
  if (state.authorized) renderDashboard();
});

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

function renderAvatar(name, avatarPath, size = '') {
  let tone = 0;
  for (const char of String(name || '')) tone = (tone * 31 + char.charCodeAt(0)) % 5;
  const url = avatarPath ? state.avatarUrls[avatarPath] : '';
  const sizeClass = size ? ` avatar-${size}` : '';
  if (!url) return element('span', `avatar tone-${tone}${sizeClass}`, initials(name));
  const wrapper = element('span', `avatar has-photo${sizeClass}`);
  const photo = document.createElement('img');
  photo.src = url;
  photo.alt = '';
  photo.decoding = 'async';
  wrapper.append(photo);
  return wrapper;
}

function teamMember(userId) {
  return userId ? state.team[userId] || null : null;
}

function firstWord(value) {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

function fillVariables(text, ticket) {
  const client = firstWord(ticket?.client_name);
  const agent = firstWord(state.profile?.display_name) || 'el equipo de soporte';
  return text
    .replace(/, \{nombre\}/g, client ? `, ${client}` : '')
    .replace(/\{nombre\}/g, client)
    .replace(/\{agente\}/g, agent);
}

const foldText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR');

// Los borradores quedan en este navegador, separados por cuenta, para no perderlos al recargar.
function draftsKey() {
  const userId = state.session?.user?.id;
  return userId ? `${DRAFTS_KEY}.${userId}` : '';
}

function loadDrafts() {
  state.drafts = {};
  state.noteDrafts = {};
  const key = draftsKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    if (saved && typeof saved === 'object') {
      state.drafts = typeof saved.reply === 'object' && saved.reply ? saved.reply : {};
      state.noteDrafts = typeof saved.note === 'object' && saved.note ? saved.note : {};
    }
  } catch { /* Borradores ilegibles: se arranca de cero. */ }
}

let draftsTimer = null;
function saveDrafts() {
  const key = draftsKey();
  if (!key) return;
  window.clearTimeout(draftsTimer);
  draftsTimer = window.setTimeout(() => {
    try {
      if (!Object.keys(state.drafts).length && !Object.keys(state.noteDrafts).length) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ reply: state.drafts, note: state.noteDrafts }));
    } catch { /* Sin almacenamiento: los borradores quedan solo en memoria. */ }
  }, 300);
}

function clearSavedDrafts() {
  const key = draftsKey();
  window.clearTimeout(draftsTimer);
  try { if (key) localStorage.removeItem(key); } catch { /* Nada que borrar. */ }
}

function memberName(member, fallback = 'Equipo UVR Home') {
  return member?.display_name || fallback;
}

function formatMonthYear(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(new Date(value));
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

function showToast(message, actionLabel, onAction, duration = 12000) {
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
  window.setTimeout(() => toast.remove(), duration);
}

// Avisos de escritorio: botón en el menú, menú desplegable, tarjeta en el resumen y comandos de la paleta.
let notifyMenuOpen = false;
const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

function isNotifyMenuOpen() {
  return notifyMenuOpen;
}

function snoozeEndLabel() {
  const until = new Date(snoozedUntil());
  const sameDay = until.toDateString() === new Date().toDateString();
  return `${sameDay ? '' : 'mañana '}${formatTime(until)}`;
}

// "p. m." ya termina en punto: evita el ".." al cerrar la oración.
function endSentence(text) {
  return text.endsWith('.') ? text : `${text}.`;
}

function untilTomorrowMorning() {
  const morning = new Date();
  morning.setDate(morning.getDate() + 1);
  morning.setHours(9, 0, 0, 0);
  return morning.getTime() - Date.now();
}

function notifyLabel(status) {
  if (status === 'on') return 'Avisos activados';
  if (status === 'snoozed') return `Silenciados hasta ${snoozeEndLabel()}`;
  if (status === 'denied') return 'Avisos bloqueados';
  return 'Activar avisos';
}

async function turnOnNotify() {
  const status = await enableNotify();
  if (state.authorized) renderDashboard();
  if (status === 'on') {
    showToast('Listo. Te avisamos de lo nuevo cuando no estés mirando el portal.', 'Probar', sendTestNotice, 8000);
    void pollSupport();
  } else if (status === 'denied') {
    showToast('El navegador bloqueó los avisos. Podés habilitarlos desde el candado de la barra de direcciones.', '', null, 10000);
  }
}

function setNotifyMode(action) {
  if (action === 'snooze') snoozeNotify();
  if (action === 'tomorrow') snoozeNotify(untilTomorrowMorning());
  if (action === 'resume') resumeNotify();
  if (action === 'off') disableNotify();
  if (state.authorized) renderDashboard();
  const messages = {
    snooze: endSentence(`No molestar hasta ${snoozeEndLabel()}`),
    tomorrow: endSentence(`No molestar hasta ${snoozeEndLabel()}`),
    resume: 'Avisos reanudados.',
    off: 'Avisos desactivados. Podés volver a activarlos desde el menú.',
  };
  showToast(messages[action], action === 'snooze' || action === 'tomorrow' ? 'Reanudar' : '', () => setNotifyMode('resume'), 6000);
}

function sendTestNotice() {
  const sent = showDesktopNotice({
    title: 'Así se ven los avisos',
    body: 'Te vamos a avisar de tickets nuevos, respuestas de tus clientes y menciones del equipo.',
    tag: 'uvr-test',
    force: true,
  });
  if (!sent) showToast('Este navegador no muestra avisos desde una pestaña. Probá desde una computadora.', '', null, 8000);
}

function fillNotifyMenu(menu) {
  const status = notifyStatus();
  const descriptions = {
    on: 'Te avisamos de tickets nuevos, respuestas de tus clientes y menciones, solo cuando no estás mirando el portal.',
    snoozed: `${endSentence(`Silenciados hasta ${snoozeEndLabel()}`)} Mientras tanto, lo nuevo te espera en la bandeja.`,
    off: 'Enterate de lo nuevo aunque estés en otra pestaña. Solo lo que te toca, nunca spam.',
    denied: 'El navegador bloqueó los avisos para este sitio. Habilitalos desde el candado de la barra de direcciones y recargá la página.',
  };
  const head = element('div', 'notify-menu-head');
  const badge = element('span', `notify-state is-${status}`, { on: 'Activos', snoozed: 'No molestar', off: 'Apagados', denied: 'Bloqueados' }[status] || '');
  const titleRow = element('div', 'notify-menu-title');
  titleRow.append(element('strong', '', 'Avisos de escritorio'), badge);
  head.append(titleRow, element('p', '', descriptions[status] || ''));
  const options = element('div', 'notify-options');
  const option = (glyph, label, hint, run) => {
    const button = element('button', 'notify-option');
    button.type = 'button';
    const text = element('span', 'notify-option-text');
    text.append(element('span', '', label));
    if (hint) text.append(element('small', '', hint));
    button.append(icon(glyph), text);
    button.addEventListener('click', () => {
      if (supportsPopover) menu.hidePopover();
      run();
    });
    options.append(button);
  };
  if (status === 'off') option('bell', 'Activar avisos', 'El navegador te va a pedir permiso', () => void turnOnNotify());
  if (status === 'on') {
    option('bellOff', 'No molestar 1 hora', 'Pausa los avisos y después vuelven solos', () => setNotifyMode('snooze'));
    option('moon', 'No molestar hasta mañana', 'Se reanudan a las 9:00', () => setNotifyMode('tomorrow'));
    option('test', 'Probar un aviso', '', sendTestNotice);
  }
  if (status === 'snoozed') option('bell', 'Reanudar avisos', '', () => setNotifyMode('resume'));
  if (status === 'on' || status === 'snoozed') option('close', 'Desactivar avisos', '', () => setNotifyMode('off'));
  menu.replaceChildren(head);
  if (options.childElementCount) menu.append(options);
}

function placeNotifyMenu(menu, button) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 16);
  const beside = window.innerWidth > 860 && rect.right < window.innerWidth / 3;
  menu.style.width = `${width}px`;
  if (beside) {
    menu.style.left = `${rect.right + 12}px`;
    menu.style.top = 'auto';
    menu.style.bottom = `${Math.max(8, window.innerHeight - rect.bottom)}px`;
  } else {
    menu.style.left = `${Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)}px`;
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.bottom = 'auto';
  }
}

function renderNotifyControl() {
  const status = notifyStatus();
  if (status === 'unsupported') return null;
  const fragment = document.createDocumentFragment();
  const button = element('button', `cmd-button notify-button is-${status}`);
  button.type = 'button';
  const label = notifyLabel(status);
  button.title = label;
  button.setAttribute('aria-label', label);
  const glyph = element('span', 'notify-glyph');
  glyph.append(icon(status === 'on' || status === 'off' ? 'bell' : 'bellOff', 'cmd-icon'), element('span', 'notify-dot'));
  button.append(glyph, element('span', 'cmd-label', status === 'snoozed' ? 'Avisos en pausa' : label));
  fragment.append(button);
  if (!supportsPopover) {
    button.addEventListener('click', () => {
      if (status === 'off') void turnOnNotify();
      else if (status === 'on') setNotifyMode('snooze');
      else if (status === 'snoozed') setNotifyMode('resume');
      else showToast('El navegador bloqueó los avisos. Podés habilitarlos desde el candado de la barra de direcciones.', '', null, 10000);
    });
    return fragment;
  }
  const menu = element('div', 'notify-menu');
  menu.id = 'notify-menu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Avisos de escritorio');
  button.popoverTargetElement = menu;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  menu.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'open') return;
    fillNotifyMenu(menu);
    placeNotifyMenu(menu, button);
  });
  menu.addEventListener('toggle', (event) => {
    notifyMenuOpen = event.newState === 'open';
    button.setAttribute('aria-expanded', String(notifyMenuOpen));
    button.classList.toggle('is-open', notifyMenuOpen);
    if (notifyMenuOpen) menu.querySelector('.notify-option')?.focus();
  });
  fragment.append(menu);
  return fragment;
}

function renderNotifyOffer() {
  const card = element('section', 'notify-offer');
  card.setAttribute('aria-label', 'Avisos de escritorio');
  const glyph = element('span', 'notify-offer-icon');
  glyph.append(icon('bell'));
  const text = element('div', 'notify-offer-text');
  text.append(
    element('strong', '', 'Enterate al instante, aunque estés en otra pestaña'),
    element('p', '', 'Te avisamos solo de lo que te toca: tickets nuevos, respuestas de tus clientes y menciones del equipo. Los silenciás cuando quieras.')
  );
  const actions = element('div', 'notify-offer-actions');
  const later = element('button', 'text-button', 'Ahora no');
  later.type = 'button';
  later.addEventListener('click', () => {
    dismissNotifyOffer();
    card.remove();
    showToast('Cuando quieras, activalos desde “Avisos” en el menú.', '', null, 6000);
  });
  const enable = element('button', 'primary-button');
  enable.type = 'button';
  enable.append(icon('bell'), element('span', '', 'Activar avisos'));
  enable.addEventListener('click', () => void turnOnNotify());
  actions.append(later, enable);
  card.append(glyph, text, actions);
  return card;
}

function notifyCommands() {
  const status = notifyStatus();
  const group = 'Avisos';
  const keywords = 'notificaciones escritorio campana alertas';
  if (status === 'off') return [{ group, label: 'Activar avisos de escritorio', keywords, run: () => void turnOnNotify() }];
  if (status === 'on') {
    return [
      { group, label: 'No molestar 1 hora', keywords: `${keywords} silenciar pausar`, run: () => setNotifyMode('snooze') },
      { group, label: 'No molestar hasta mañana', keywords: `${keywords} silenciar pausar`, run: () => setNotifyMode('tomorrow') },
      { group, label: 'Probar un aviso de escritorio', keywords, run: sendTestNotice },
      { group, label: 'Desactivar avisos de escritorio', keywords, run: () => setNotifyMode('off') },
    ];
  }
  if (status === 'snoozed') {
    return [
      { group, label: 'Reanudar avisos', keywords: `${keywords} no molestar`, run: () => setNotifyMode('resume') },
      { group, label: 'Desactivar avisos de escritorio', keywords, run: () => setNotifyMode('off') },
    ];
  }
  return [];
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function setFeedback(error = '', notice = '') {
  state.error = error;
  state.notice = '';
  // En el panel, los avisos de éxito son efímeros: no se quedan pegados en cada pantalla.
  if (notice && state.authorized) showToast(notice, '', null, 5000);
  else state.notice = notice;
}

function userFacingError(error, fallback) {
  if (error?.userMessage) return error.userMessage;
  const message = typeof error?.message === 'string' ? error.message.toLocaleLowerCase('en') : '';
  const code = typeof error?.code === 'string' ? error.code.toLocaleLowerCase('en') : '';

  // Los mensajes de las funciones SQL ya están escritos para las personas usuarias.
  if (code === 'p0001' && typeof error.message === 'string' && error.message) return error.message;
  if (message.includes('maximum allowed size') || message.includes('exceeded the maximum')) {
    return 'La foto pesa demasiado. Elegí una de hasta 1 MB.';
  }
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
  state.activity = [];
  state.threadFor = null;
  state.agents = [];
  state.dashboardStats = null;
  state.messageRequest += 1;
  state.ticketRequest += 1;
  state.agentRequest += 1;
  state.statsRequest += 1;
  app.replaceChildren(element('main', 'loading', 'Verificando permisos…'));
}

function skeleton(className) {
  const block = element('span', `skeleton ${className}`);
  block.setAttribute('aria-hidden', 'true');
  return block;
}

function renderTicketRowSkeleton(index) {
  const row = element('div', 'ticket-row ticket-row-skeleton');
  row.setAttribute('aria-hidden', 'true');
  const body = element('span', 'ticket-row-body');
  const top = element('span', 'ticket-row-top');
  top.append(skeleton('sk-line sk-name'), skeleton('sk-line sk-time'));
  const meta = element('span', 'ticket-row-meta');
  meta.append(skeleton('sk-pill'), skeleton('sk-line sk-meta'));
  body.append(top, skeleton(`sk-line sk-subject sk-w${index % 3}`), meta);
  row.append(skeleton('sk-avatar'), body);
  return row;
}

function renderThreadSkeleton() {
  const wrap = element('div', 'thread-skeleton');
  wrap.setAttribute('aria-hidden', 'true');
  [['in', 2], ['out', 1], ['in', 1], ['out', 2]].forEach(([side, lines], index) => {
    const item = element('div', `sk-msg is-${side}`);
    if (side === 'in') item.append(skeleton('sk-avatar sk-avatar-sm'));
    const bubble = element('div', 'sk-bubble');
    for (let line = 0; line < lines; line += 1) bubble.append(skeleton(`sk-line sk-w${(index + line) % 3}`));
    item.append(bubble);
    wrap.append(item);
  });
  return wrap;
}

function renderDetailSkeleton() {
  const panel = element('section', 'detail-panel detail-skeleton');
  panel.setAttribute('aria-busy', 'true');
  panel.setAttribute('aria-label', 'Cargando ticket');
  const header = element('header', 'detail-bar');
  const title = element('div', 'detail-title');
  const text = element('div', 'detail-title-text');
  text.append(skeleton('sk-line sk-title'), skeleton('sk-line sk-meta'));
  title.append(skeleton('sk-avatar'), text);
  header.append(title);
  const thread = element('div', 'thread');
  thread.append(renderThreadSkeleton());
  panel.append(header, thread);
  return panel;
}

function renderOverviewSkeleton() {
  const wrap = element('div', 'overview-skeleton');
  wrap.setAttribute('aria-busy', 'true');
  wrap.append(element('span', 'sr-only', 'Cargando tus estadísticas…'));
  const metrics = element('div', 'overview-metrics');
  for (let index = 0; index < 5; index += 1) {
    const card = element('div', 'stat-card sk-card');
    card.append(skeleton('sk-line sk-label'), skeleton('sk-line sk-number'), skeleton('sk-line sk-meta'));
    metrics.append(card);
  }
  const cards = element('div', 'overview-grid sk-panels');
  [5, 4].forEach((rows) => {
    const card = element('div', 'overview-card sk-panel');
    card.append(skeleton('sk-line sk-title'), skeleton('sk-line sk-meta'));
    for (let index = 0; index < rows; index += 1) card.append(skeleton(`sk-line sk-row sk-w${index % 3}`));
    cards.append(card);
  });
  wrap.append(metrics, cards);
  return wrap;
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
  if (ticket.id !== state.selectedId && (state.drafts[ticket.id] || state.noteDrafts[ticket.id])) {
    meta.append(element('span', 'ticket-row-draft', 'Borrador'));
  }
  if (state.role === 'owner') {
    const assignedAgent = state.agents.find((agent) => agent.user_id === ticket.assigned_agent_id);
    meta.append(element('span', 'ticket-row-agent', ticket.assigned_agent_id === state.session?.user?.id
      ? 'Tomado por vos'
      : assignedAgent
      ? `${assignedAgent.email}${assignedAgent.removed_at ? ' · fuera del equipo' : ''}`
      : 'Sin asignar'));
  } else if (!ticket.assigned_agent_id) {
    meta.append(element('span', 'ticket-row-agent', 'Sin asignar'));
  }
  body.append(meta);
  button.append(renderAvatar(ticket.client_name), body);
  button.addEventListener('click', () => selectTicket(ticket.id));
  return button;
}

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

function formatDay(value) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(value)) / 86400000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  const date = new Date(value);
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  const label = new Intl.DateTimeFormat('es-AR', options).format(date);
  return label.charAt(0).toLocaleUpperCase('es-AR') + label.slice(1);
}

function formatTime(value) {
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function threadItems() {
  const view = state.threadView;
  const items = [];
  if (view !== 'notes') state.messages.forEach((message) => items.push({ type: 'message', ...message }));
  state.activity.forEach((entry) => {
    if (view === 'notes' && entry.kind !== 'note') return;
    if (view === 'chat') return;
    items.push({ type: entry.kind, ...entry });
  });
  return items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function renderThread(thread, ticket) {
  let previous = null;
  let previousDay = null;
  threadItems().forEach((item) => {
    const day = startOfDay(item.created_at).getTime();
    const newDay = day !== previousDay;
    if (newDay) {
      const divider = element('div', 'thread-day');
      divider.append(element('span', '', formatDay(item.created_at)));
      thread.append(divider);
      previousDay = day;
    }
    if (item.type === 'note') thread.append(renderNote(item));
    else if (item.type !== 'message') thread.append(renderEvent(item));
    else {
      // Mensajes seguidos de la misma persona en pocos minutos se agrupan, como en cualquier chat.
      const grouped = !newDay
        && previous?.type === 'message'
        && previous.author_role === item.author_role
        && previous.author_id === item.author_id
        && new Date(item.created_at) - new Date(previous.created_at) < 5 * 60000;
      thread.append(renderMessage(item, ticket, grouped));
    }
    previous = item;
  });
  [...state.delivering, state.pendingSend]
    .filter((item) => item?.ticketId === ticket.id)
    .forEach((item) => thread.append(renderOutgoing(item, ticket)));
}

function renderOutgoing(item, ticket) {
  const row = renderMessage({
    author_role: 'support',
    author_id: state.session?.user?.id,
    body: item.body,
    attachments: item.attachments,
    created_at: item.createdAt,
  }, ticket, false);
  row.classList.add('is-outgoing');
  const stack = row.querySelector('.msg-stack');
  const status = element('div', 'msg-outgoing');
  if (item === state.pendingSend) {
    const bar = element('span', 'undo-bar');
    bar.style.animationDelay = `-${Date.now() - item.queuedAt}ms`;
    const undo = element('button', 'undo-button', 'Deshacer');
    undo.type = 'button';
    undo.addEventListener('click', undoPendingSend);
    status.append(element('span', '', 'Se envía en unos segundos'), undo, bar);
  } else {
    status.append(element('span', 'is-sending', 'Enviando…'));
  }
  stack?.append(status);
  return row;
}

function actorName(actorId) {
  if (!actorId) return 'Sistema';
  if (actorId === state.session?.user?.id) return 'Vos';
  return memberName(teamMember(actorId), 'Alguien del equipo');
}

function renderNote(note) {
  const name = actorName(note.actor_id);
  const member = teamMember(note.actor_id);
  const row = element('article', 'thread-note');
  row.setAttribute('aria-label', `Nota interna de ${name}`);
  const head = element('header', 'note-head');
  const time = element('time', '', formatTime(note.created_at));
  time.dateTime = note.created_at;
  time.title = formatDate(note.created_at);
  const tag = element('span', 'note-tag');
  tag.append(icon('lock'), element('span', '', 'Nota interna'));
  head.append(renderAvatar(memberName(member, name), member?.avatar_path, 'xs'), element('strong', '', name), tag, time);
  const body = element('p', 'note-body');
  // Las menciones (@Nombre) se resaltan para que se vean de un vistazo.
  String(note.body || '').split(/(@[\p{L}\p{N}_.-]+)/u).forEach((part) => {
    if (!part) return;
    body.append(part.startsWith('@') ? element('mark', 'note-mention', part) : document.createTextNode(part));
  });
  row.append(head, body);
  return row;
}

function renderEvent(entry) {
  const actor = actorName(entry.actor_id);
  const detail = entry.detail || {};
  const row = element('div', `thread-event event-${entry.kind}`);
  const text = element('span', 'event-text');
  if (entry.kind === 'status') {
    text.append(`${actor === 'Sistema' ? 'El estado pasó' : `${actor} ${actor === 'Vos' ? 'pasaste' : 'pasó'} el ticket`} a `);
    text.append(element('span', `status status-${detail.to}`, statusNames[detail.to] || detail.to || '—'));
  } else if (!detail.to) {
    text.textContent = `${actor} dejó el ticket sin asignar`;
  } else if (!entry.actor_id) {
    text.textContent = `Se asignó automáticamente a ${actorName(detail.to)}`;
  } else if (detail.to === entry.actor_id) {
    text.textContent = `${actor} ${actor === 'Vos' ? 'tomaste' : 'tomó'} el ticket`;
  } else {
    text.textContent = `${actor} ${actor === 'Vos' ? 'asignaste' : 'asignó'} el ticket a ${actorName(detail.to)}`;
  }
  const time = element('time', '', formatTime(entry.created_at));
  time.dateTime = entry.created_at;
  time.title = formatDate(entry.created_at);
  row.append(icon(entry.kind === 'status' ? 'check' : 'swap', 'event-icon'), text, time);
  return row;
}

function renderThreadFilter() {
  const notes = state.activity.filter((entry) => entry.kind === 'note').length;
  if (!notes) return null;
  const bar = element('div', 'thread-filter');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Qué mostrar en la conversación');
  [['all', 'Todo'], ['chat', 'Conversación'], ['notes', `Notas · ${notes}`]].forEach(([value, label]) => {
    const option = element('button', `thread-filter-option${state.threadView === value ? ' is-active' : ''}`, label);
    option.type = 'button';
    option.setAttribute('aria-pressed', String(state.threadView === value));
    option.addEventListener('click', () => {
      state.threadView = value;
      renderDashboard();
    });
    bar.append(option);
  });
  return bar;
}

function setComposerMode(mode) {
  if (state.composerMode === mode) {
    app.querySelector('.reply-input')?.focus();
    return;
  }
  state.composerMode = mode;
  state.quickMenuOpen = false;
  renderDashboard();
  const input = app.querySelector('.reply-input');
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

function renderMessage(message, ticket, grouped) {
  const fromSupport = message.author_role === 'support';
  const member = fromSupport ? teamMember(message.author_id) : null;
  const name = fromSupport ? memberName(member) : (ticket.client_name || 'Cliente');
  const row = element('article', `msg${fromSupport ? ' from-support' : ''}${grouped ? ' is-grouped' : ''}`);
  const avatarSlot = element('div', 'msg-avatar');
  if (!grouped) avatarSlot.append(renderAvatar(name, member?.avatar_path, 'sm'));
  const stack = element('div', 'msg-stack');
  if (!grouped) {
    const meta = element('div', 'msg-meta');
    const time = element('time', '', formatTime(message.created_at));
    time.dateTime = message.created_at;
    time.title = formatDate(message.created_at);
    meta.append(element('strong', '', name), time);
    stack.append(meta);
  }
  const attachments = renderAttachments(message.attachments);
  if (attachments) stack.append(attachments);
  if (message.body) {
    const bubble = element('p', 'msg-bubble', message.body);
    bubble.title = formatDate(message.created_at);
    stack.append(bubble);
  }
  row.append(avatarSlot, stack);
  return row;
}

function isImageAttachment(item) {
  return String(item?.mime || '').startsWith('image/');
}

function formatBytes(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
}

function attachmentUrl(item) {
  return item.preview || state.attachUrls[item.path]?.url || '';
}

function renderAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments.filter((item) => item?.path) : [];
  if (!list.length) return null;
  const wrap = element('div', 'msg-attachments');
  const images = list.filter(isImageAttachment);
  if (images.length) {
    const grid = element('div', `attach-grid count-${images.length}`);
    images.forEach((item) => {
      const tile = element('button', 'attach-image attach-tile');
      tile.type = 'button';
      tile.dataset.attachPath = item.path;
      tile.dataset.attachName = item.name || 'Imagen';
      tile.setAttribute('aria-label', `Ver ${item.name || 'imagen'}`);
      if (images.length === 1 && item.width > 0 && item.height > 0) {
        // Una sola imagen se muestra entera, con su proporción y sin pasar de 320 x 340 px.
        tile.style.aspectRatio = `${item.width} / ${item.height}`;
        tile.style.width = `${Math.max(140, Math.round(Math.min(320, (340 * item.width) / item.height)))}px`;
      }
      const image = document.createElement('img');
      image.alt = item.name || '';
      image.decoding = 'async';
      image.loading = 'lazy';
      const url = attachmentUrl(item);
      if (url) image.src = url;
      else tile.classList.add('is-loading');
      image.addEventListener('error', () => tile.classList.add('is-broken'));
      tile.append(image);
      tile.addEventListener('click', () => openViewer(tile));
      grid.append(tile);
    });
    wrap.append(grid);
  }
  list.filter((item) => !isImageAttachment(item)).forEach((item) => {
    const link = element('a', 'attach-file');
    link.dataset.attachPath = item.path;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const url = attachmentUrl(item);
    if (url) link.href = url;
    else link.classList.add('is-loading');
    const text = element('span', 'attach-file-text');
    text.append(element('strong', '', item.name || 'Archivo'), element('span', '', `PDF · ${formatBytes(item.size)}`));
    link.append(icon('file', 'attach-file-icon'), text, icon('download', 'attach-file-action'));
    link.title = `Abrir ${item.name || 'el archivo'}`;
    wrap.append(link);
  });
  return wrap;
}

// Las URLs firmadas se piden en lote y se pintan sin volver a renderizar, porque el chat se re-renderiza mientras se escribe.
let attachSigning = false;
async function resolveAttachmentUrls() {
  if (attachSigning || !state.authorized || state.threadFor !== state.selectedId) return;
  const now = Date.now();
  const paths = [...new Set(state.messages.flatMap((message) => (Array.isArray(message.attachments) ? message.attachments : []).map((item) => item?.path)))]
    .filter((path) => path && (!state.attachUrls[path] || now - state.attachUrls[path].at > ATTACH_URL_REFRESH_MS));
  if (!paths.length) return;
  attachSigning = true;
  const userId = state.session?.user?.id;
  const { data, error } = await state.supabase.storage.from(ATTACH_BUCKET).createSignedUrls(paths, ATTACH_URL_TTL_SECONDS)
    .catch((requestError) => ({ error: requestError }));
  attachSigning = false;
  if (error || !data || userId !== state.session?.user?.id) return;
  data.forEach((item) => {
    if (item.signedUrl) state.attachUrls[item.path] = { url: item.signedUrl, at: Date.now() };
  });
  paintAttachmentUrls();
}

function paintAttachmentUrls() {
  document.querySelectorAll('[data-attach-path].is-loading').forEach((node) => {
    const url = state.attachUrls[node.dataset.attachPath]?.url;
    if (!url) return;
    node.classList.remove('is-loading');
    if (node.tagName === 'A') node.href = url;
    else {
      const image = node.querySelector('img');
      if (image) image.src = url;
    }
  });
}

function downloadUrl(url, name) {
  if (!/^https?:/i.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name || 'imagen')}`;
}

// Visor a pantalla completa: recorre todas las imágenes del ticket con las flechas.
function openViewer(trigger) {
  const tiles = [...app.querySelectorAll('.thread .attach-image')];
  const items = tiles.map((tile) => ({
    path: tile.dataset.attachPath,
    name: tile.dataset.attachName,
    src: () => tile.querySelector('img')?.currentSrc || state.attachUrls[tile.dataset.attachPath]?.url || '',
  }));
  let index = Math.max(0, tiles.indexOf(trigger));
  if (!items.length) return;
  document.querySelector('dialog.viewer')?.remove();
  const dialog = element('dialog', 'viewer');
  dialog.setAttribute('aria-label', 'Imágenes adjuntas');
  const bar = element('header', 'viewer-bar');
  const name = element('strong', 'viewer-name');
  const count = element('span', 'viewer-count');
  const download = element('a', 'viewer-action');
  download.target = '_blank';
  download.rel = 'noopener noreferrer';
  download.title = 'Descargar';
  download.setAttribute('aria-label', 'Descargar imagen');
  download.append(icon('download'));
  const close = element('button', 'viewer-action');
  close.type = 'button';
  close.title = 'Cerrar (Esc)';
  close.setAttribute('aria-label', 'Cerrar visor');
  close.append(icon('close'));
  close.addEventListener('click', () => dialog.close());
  const info = element('div', 'viewer-info');
  info.append(name, count);
  bar.append(info, download, close);
  const stage = element('div', 'viewer-stage');
  const image = document.createElement('img');
  image.decoding = 'async';
  const arrow = (direction, glyph, label) => {
    const button = element('button', `viewer-nav is-${direction > 0 ? 'next' : 'prev'}`);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.append(icon(glyph));
    button.addEventListener('click', () => step(direction));
    return button;
  };
  const prev = arrow(-1, 'chevronLeft', 'Imagen anterior');
  const next = arrow(1, 'chevronRight', 'Imagen siguiente');
  stage.append(prev, image, next);
  stage.addEventListener('click', (event) => {
    if (event.target === stage) dialog.close();
  });
  const paint = () => {
    const item = items[index];
    const src = item.src();
    image.src = src;
    image.alt = item.name || '';
    name.textContent = item.name || 'Imagen';
    count.textContent = `${index + 1} de ${items.length}`;
    download.href = downloadUrl(src, item.name);
    prev.hidden = next.hidden = items.length < 2;
  };
  function step(direction) {
    index = (index + direction + items.length) % items.length;
    paint();
  }
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  dialog.addEventListener('close', () => {
    const path = items[index]?.path;
    dialog.remove();
    const target = [...app.querySelectorAll('.thread .attach-image')].find((tile) => tile.dataset.attachPath === path);
    (target || trigger)?.focus({ preventScroll: true });
  });
  dialog.append(bar, stage);
  document.body.append(dialog);
  paint();
  dialog.showModal();
  close.focus();
}

function renderClientPanel(ticket, manage) {
  const context = state.clientContexts[ticket.id];
  const panel = element('section', 'client-panel');
  panel.setAttribute('aria-label', 'Detalles del ticket');
  if (manage) panel.append(manage);
  const clientBlock = element('div', 'side-section client-block');
  clientBlock.append(element('h3', 'side-title', 'Cliente'));
  const identity = element('div', 'client-identity');
  identity.append(renderAvatar(ticket.client_name, null, 'lg'));
  const names = element('div', 'client-names');
  names.append(
    element('strong', '', ticket.client_name),
    element('span', 'muted', context?.account_role === 'cleaner' ? 'Profesional' : context?.account_role === 'client' ? 'Cliente' : 'Usuario de UVR Home')
  );
  identity.append(names);
  clientBlock.append(identity);
  panel.append(clientBlock);
  if (!context) {
    clientBlock.append(element('p', 'muted client-note', context === null ? 'No pudimos cargar los datos de la cuenta.' : 'Cargando datos de la cuenta…'));
    return panel;
  }
  const badge = element(
    'span',
    `trust-badge ${context.identity_verified ? 'is-verified' : 'is-unverified'}`,
    context.identity_verified ? '✓ Identidad verificada' : 'Identidad sin verificar'
  );
  const facts = element('dl', 'client-facts');
  [
    ['Con nosotros desde', formatMonthYear(context.member_since)],
    ['Servicios completados', String(context.completed_services ?? 0)],
    ['Servicios cancelados', String(context.cancelled_services ?? 0)],
    ['Tickets', `${context.tickets_total ?? 0} · ${context.tickets_open ?? 0} ${Number(context.tickets_open) === 1 ? 'abierto' : 'abiertos'}`],
    ['App', `${ticket.app_version || '—'} · ${ticket.platform}`],
  ].forEach(([label, value]) => {
    const row = element('div', '');
    row.append(element('dt', '', label), element('dd', '', value));
    facts.append(row);
  });
  clientBlock.append(badge, facts);
  panel.append(element('p', 'fine-print client-note', 'No mostramos teléfono, correo ni documentos. Solo lo necesario para atender el caso.'));
  return panel;
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
  const subject = element('h2', '', ticket.subject);
  subject.title = ticket.subject;
  titleText.append(subject);
  const context = element('p', 'ticket-context');
  const created = element('span', '', `Creado ${formatAge(ticket.created_at)}`);
  created.title = formatDate(ticket.created_at);
  context.append(
    element('span', `status status-${ticket.status}`, statusNames[ticket.status] || ticket.status),
    element('span', '', ticket.client_name),
    element('span', '', typeNames[ticket.ticket_type] || 'Ayuda'),
    created
  );
  const viewers = element('p', 'ticket-viewers');
  fillViewers(viewers, ticket.id);
  viewers.setAttribute('role', 'status');
  titleText.append(context, viewers);
  title.append(renderAvatar(ticket.client_name), titleText);
  const controls = element('div', 'ticket-controls');
  const manage = element('div', 'side-section manage-block');
  manage.append(element('h3', 'side-title', 'Gestión'));
  const manageFields = element('div', 'manage-fields');
  manage.append(manageFields);
  const field = (labelText, control) => {
    const label = element('label', 'manage-field');
    label.append(element('span', '', labelText), control);
    manageFields.append(label);
  };
  if (state.role === 'owner') {
    const assignment = document.createElement('select');
    assignment.className = 'status-select';
    assignment.setAttribute('aria-label', 'Agente asignado');
    const unassigned = document.createElement('option');
    unassigned.value = '';
    unassigned.textContent = 'Sin asignar';
    const activeAgents = state.agents.filter((agent) => agent.role === 'agent' && agent.active);
    assignment.append(unassigned);
    activeAgents.forEach((agent) => {
      const option = document.createElement('option');
      option.value = agent.user_id;
      option.textContent = agent.email;
      assignment.append(option);
    });
    const myId = state.session?.user?.id;
    const takenByMe = ticket.assigned_agent_id === myId;
    if (takenByMe) {
      const mine = document.createElement('option');
      mine.value = myId;
      mine.textContent = 'Vos (propietario)';
      assignment.append(mine);
    }
    if (!activeAgents.length && !takenByMe) unassigned.textContent = 'Sin asignar · sin agentes activos';
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
    assignment.addEventListener('change', () => (assignment.value === myId
      ? claimTicket(ticket.id)
      : assignTicket(ticket.id, assignment.value || null)));
    field('Asignado a', assignment);
  }
  const detailsToggle = element('button', `icon-button details-toggle${state.showDetails ? ' is-on' : ''}`);
  detailsToggle.type = 'button';
  detailsToggle.title = state.showDetails ? 'Ocultar detalles' : 'Mostrar detalles';
  detailsToggle.setAttribute('aria-label', 'Detalles del ticket');
  detailsToggle.setAttribute('aria-pressed', String(state.showDetails));
  detailsToggle.append(icon('panel'));
  detailsToggle.addEventListener('click', () => {
    state.showDetails = !state.showDetails;
    if (isWideDetails()) {
      try { localStorage.setItem(DETAILS_PREF, state.showDetails ? '1' : '0'); } catch { /* Sin almacenamiento: queda solo en memoria. */ }
    }
    renderDashboard();
  });
  const takenByMeNow = ticket.assigned_agent_id === state.session?.user?.id;
  const canTake = !takenByMeNow
    && !['resolved', 'closed'].includes(ticket.status)
    && (state.role === 'owner' || !ticket.assigned_agent_id);
  if (canTake) {
    const take = element('button', 'primary-button take-button', 'Tomar ticket');
    take.type = 'button';
    take.disabled = state.busy;
    take.addEventListener('click', () => claimTicket(ticket.id));
    controls.append(take);
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
  const statusField = element('label', 'manage-field');
  statusField.append(element('span', '', 'Estado'), status);
  manageFields.prepend(statusField);
  controls.append(detailsToggle);
  header.append(backToList, title, controls);
  panel.append(header);

  const thread = element('div', 'thread');
  thread.dataset.ticketId = ticket.id;
  if (state.threadFor !== ticket.id) {
    thread.setAttribute('aria-busy', 'true');
    thread.append(renderThreadSkeleton());
  } else {
    renderThread(thread, ticket);
    if (!state.messages.length && !state.activity.length) {
      thread.append(element('p', 'muted thread-empty', state.threadError === ticket.id
        ? 'No pudimos cargar la conversación. Probá actualizar.'
        : 'Todavía no hay mensajes.'));
    }
  }
  const split = element('div', state.showDetails ? 'detail-split' : 'detail-split is-collapsed');
  const main = element('div', 'detail-main');
  const threadFilter = renderThreadFilter();
  if (threadFilter) main.append(threadFilter);
  main.append(thread);

  const noteMode = state.composerMode === 'note';
  const drafts = noteMode ? state.noteDrafts : state.drafts;
  const form = element('form', `reply-form composer${noteMode ? ' is-note' : ''}`);
  // Con adjuntos se puede enviar sin texto: la validación la hace submitReply.
  form.noValidate = true;
  const modes = element('div', 'composer-modes');
  modes.setAttribute('role', 'tablist');
  modes.setAttribute('aria-label', 'Tipo de mensaje');
  [['reply', 'Responder', 'reply', 'R'], ['note', 'Nota interna', 'lock', 'N']].forEach(([value, label, glyph, key]) => {
    const tab = element('button', `composer-mode${state.composerMode === value ? ' is-active' : ''}`);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(state.composerMode === value));
    tab.title = `${label} (${key})`;
    tab.append(icon(glyph), element('span', '', label));
    if (value === 'note' && state.noteDrafts[ticket.id]) tab.append(element('span', 'mode-dot', ''));
    if (value === 'reply' && state.drafts[ticket.id]) tab.append(element('span', 'mode-dot', ''));
    tab.addEventListener('click', () => setComposerMode(value));
    modes.append(tab);
  });
  const box = element('div', 'composer-box');
  const quickMenu = document.createElement('details');
  quickMenu.className = 'quick-menu';
  quickMenu.open = state.quickMenuOpen;
  quickMenu.addEventListener('toggle', () => { state.quickMenuOpen = quickMenu.open; });
  const quickSummary = element('summary', 'tool-button');
  quickSummary.title = 'Respuestas rápidas';
  quickSummary.append(icon('bolt'), element('span', 'tool-label', 'Respuestas'));
  const quick = element('div', 'quick-list');
  quick.setAttribute('role', 'group');
  quick.setAttribute('aria-label', 'Respuestas rápidas');
  quickMenu.append(quickSummary, quick);
  const aiButton = element('button', 'tool-button ai-button');
  const aiLabel = element('span', 'tool-label', 'Sugerir con IA');
  aiButton.append(element('span', 'ai-spark', '✨'), aiLabel);
  aiButton.type = 'button';
  aiButton.title = 'La IA arma un borrador para que lo revises. No se envía sola.';
  aiButton.disabled = state.busy;
  const defaultHint = noteMode
    ? 'Solo la ve el equipo · el cliente nunca la recibe'
    : 'Ctrl + Enter envía';
  const aiStatus = element('span', 'ai-status is-hint', defaultHint);
  aiStatus.setAttribute('role', 'status');
  const textarea = document.createElement('textarea');
  textarea.className = 'reply-input';
  textarea.name = 'reply';
  textarea.rows = 1;
  textarea.maxLength = noteMode ? 2000 : 4000;
  textarea.required = true;
  const firstName = firstWord(ticket.client_name);
  textarea.placeholder = noteMode
    ? 'Dejá contexto para el equipo. Podés mencionar con @nombre…'
    : (firstName ? `Escribile a ${firstName}… (/ para respuestas rápidas)` : 'Escribile al usuario…');
  textarea.setAttribute('aria-label', noteMode ? 'Nota interna' : 'Respuesta');
  textarea.value = drafts[ticket.id] || '';
  const fitTextarea = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };

  // Menú "/": filtra las respuestas rápidas mientras se escribe y reemplaza el atajo por el texto.
  const slashMenu = element('div', 'quick-list slash-menu');
  slashMenu.id = `slash-menu-${ticket.id}`;
  slashMenu.setAttribute('role', 'listbox');
  slashMenu.setAttribute('aria-label', 'Respuestas rápidas');
  slashMenu.hidden = true;
  let slashMatches = [];
  let slashActive = 0;
  let slashStart = -1;
  const closeSlash = () => {
    slashMenu.hidden = true;
    slashMatches = [];
    slashStart = -1;
    textarea.removeAttribute('aria-activedescendant');
    textarea.setAttribute('aria-expanded', 'false');
  };
  const insertAt = (from, to, text) => {
    textarea.value = `${textarea.value.slice(0, from)}${text}${textarea.value.slice(to)}`;
    const caret = from + text.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event('input'));
  };
  const pickSlash = (index) => {
    const reply = slashMatches[index];
    if (!reply) return;
    const from = slashStart;
    const to = textarea.selectionStart;
    closeSlash();
    insertAt(from, to, fillVariables(reply[1], ticket));
  };
  const paintSlash = () => {
    slashMenu.replaceChildren();
    slashMatches.forEach(([name, text, slug], index) => {
      const option = element('button', `quick-item${index === slashActive ? ' is-active' : ''}`);
      option.type = 'button';
      option.id = `slash-${ticket.id}-${slug}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === slashActive));
      const head = element('span', 'slash-head');
      head.append(element('strong', '', name), element('kbd', '', `/${slug}`));
      option.append(head, element('span', '', fillVariables(text, ticket)));
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => pickSlash(index));
      slashMenu.append(option);
    });
    const active = slashMenu.children[slashActive];
    if (active) {
      textarea.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  };
  const updateSlash = () => {
    if (noteMode) return;
    const caret = textarea.selectionStart;
    const match = /(^|\s)\/([\p{L}\p{N}-]*)$/u.exec(textarea.value.slice(0, caret));
    const query = match ? foldText(match[2]) : '';
    slashMatches = match
      ? quickReplies.filter(([name, , slug]) => slug.startsWith(query) || foldText(name).includes(query))
      : [];
    if (!slashMatches.length) {
      closeSlash();
      return;
    }
    slashStart = caret - match[2].length - 1;
    slashActive = 0;
    slashMenu.hidden = false;
    textarea.setAttribute('aria-expanded', 'true');
    paintSlash();
  };
  textarea.setAttribute('aria-controls', slashMenu.id);
  textarea.setAttribute('aria-expanded', 'false');

  // Los borradores de la IA traen [completar]: Tab salta de uno a otro y no se puede enviar hasta resolverlos.
  const fillIns = () => (noteMode ? 0 : textarea.value.split(FILL_IN).length - 1);
  const updateHint = (prefix = '') => {
    const pending = fillIns();
    aiStatus.classList.remove('is-error');
    aiStatus.classList.toggle('is-fill', pending > 0);
    aiStatus.classList.toggle('is-hint', pending === 0 && !prefix);
    aiStatus.textContent = pending
      ? `${prefix}${pending} por completar · Tab`
      : (prefix ? `${prefix}Revisalo antes de enviar.` : defaultHint);
  };
  const selectFillIn = () => {
    let index = textarea.value.indexOf(FILL_IN, textarea.selectionEnd);
    if (index < 0) index = textarea.value.indexOf(FILL_IN);
    if (index < 0) return;
    textarea.focus();
    textarea.setSelectionRange(index, index + FILL_IN.length);
  };

  const submitReply = (andNext = false) => {
    const body = textarea.value.trim();
    const uploads = noteMode ? [] : state.uploads[ticket.id] || [];
    const ready = uploads.filter((item) => item.status === 'ready');
    if ((!body && !ready.length) || state.busy) {
      textarea.focus();
      return;
    }
    closeSlash();
    if (noteMode) {
      stopTyping();
      void addNote(ticket.id, body);
      return;
    }
    if (uploads.some((item) => item.status === 'uploading')) {
      aiStatus.classList.remove('is-hint', 'is-fill');
      aiStatus.classList.add('is-error');
      aiStatus.textContent = 'Esperá a que terminen de subir los archivos.';
      return;
    }
    if (body.includes(FILL_IN)) {
      aiStatus.classList.remove('is-hint', 'is-fill');
      aiStatus.classList.add('is-error');
      aiStatus.textContent = `Completá lo que dice ${FILL_IN} antes de enviar.`;
      textarea.setSelectionRange(0, 0);
      selectFillIn();
      return;
    }
    stopTyping();
    queueReply(ticket, body, andNext, ready);
  };

  textarea.addEventListener('input', () => {
    if (textarea.value) drafts[ticket.id] = textarea.value;
    else delete drafts[ticket.id];
    if (textarea.value.trim()) markTyping(noteMode ? 'note' : 'reply');
    else stopTyping();
    saveDrafts();
    fitTextarea();
    updateSlash();
    updateHint();
  });
  textarea.addEventListener('click', updateSlash);
  textarea.addEventListener('blur', closeSlash);
  if (textarea.value) requestAnimationFrame(fitTextarea);
  textarea.addEventListener('keydown', (event) => {
    if (!slashMenu.hidden) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        slashActive = (slashActive + (event.key === 'ArrowDown' ? 1 : -1) + slashMatches.length) % slashMatches.length;
        paintSlash();
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey)) {
        event.preventDefault();
        pickSlash(slashActive);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSlash();
        return;
      }
    }
    if (event.key === 'Tab' && !event.shiftKey && fillIns()) {
      event.preventDefault();
      selectFillIn();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submitReply(event.shiftKey);
    }
  });
  quickReplies.forEach(([name, text, slug]) => {
    const chip = element('button', 'quick-item');
    chip.type = 'button';
    chip.disabled = state.busy;
    const head = element('span', 'slash-head');
    head.append(element('strong', '', name), element('kbd', '', `/${slug}`));
    chip.append(head, element('span', '', fillVariables(text, ticket)));
    chip.addEventListener('click', () => {
      const current = textarea.value.trim();
      const filled = fillVariables(text, ticket);
      textarea.value = current ? `${current}\n\n${filled}` : filled;
      quickMenu.open = false;
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    quick.append(chip);
  });
  aiButton.addEventListener('click', async () => {
    aiButton.disabled = true;
    aiButton.classList.add('is-thinking');
    aiLabel.textContent = 'Pensando…';
    aiStatus.classList.remove('is-error', 'is-hint', 'is-fill');
    aiStatus.textContent = 'Leyendo la conversación…';
    const result = await requestAiDraft(ticket.id);
    aiButton.disabled = state.busy;
    aiButton.classList.remove('is-thinking');
    aiLabel.textContent = 'Sugerir con IA';
    if (result.error) {
      aiStatus.classList.add('is-error');
      aiStatus.textContent = result.error;
      return;
    }
    const current = (state.drafts[ticket.id] || '').trim();
    state.drafts[ticket.id] = current ? `${current}\n\n${result.draft}` : result.draft;
    saveDrafts();
    if (textarea.isConnected) {
      textarea.value = state.drafts[ticket.id];
      fitTextarea();
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.classList.add('is-ai-filled');
      window.setTimeout(() => textarea.classList.remove('is-ai-filled'), 1600);
      updateHint('✨ ');
      if (fillIns()) {
        textarea.setSelectionRange(0, 0);
        selectFillIn();
      }
    }
  });
  const bar = element('div', 'composer-tools');
  const send = element('button', 'primary-button send-button');
  const sendLabel = noteMode ? 'Guardar nota' : 'Enviar';
  send.append(element('span', '', state.busy ? (noteMode ? 'Guardando…' : 'Enviando…') : sendLabel), icon(noteMode ? 'lock' : 'arrow', 'send-icon'));
  send.type = 'submit';
  send.title = 'Ctrl + Enter';
  send.disabled = state.busy;
  const sendGroup = element('div', 'send-group');
  sendGroup.append(send);
  if (!noteMode) {
    const sendNext = element('button', 'send-next');
    sendNext.type = 'button';
    sendNext.title = 'Enviar y abrir el próximo pendiente (Ctrl + Shift + Enter)';
    sendNext.setAttribute('aria-label', 'Enviar y abrir el próximo pendiente');
    sendNext.append(icon('skip'));
    sendNext.disabled = state.busy;
    sendNext.addEventListener('click', () => submitReply(true));
    sendGroup.append(sendNext);
  }
  if (noteMode) bar.append(aiStatus, sendGroup);
  else {
    const fileInput = element('input', 'attach-input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = [...ATTACH_IMAGE_TYPES, 'application/pdf'].join(',');
    fileInput.tabIndex = -1;
    fileInput.hidden = true;
    fileInput.addEventListener('change', () => {
      addAttachments(ticket.id, [...fileInput.files]);
      fileInput.value = '';
    });
    const attachButton = element('button', 'tool-button attach-button');
    attachButton.type = 'button';
    attachButton.title = 'Adjuntar imágenes o PDF (también podés arrastrarlos o pegarlos)';
    attachButton.append(icon('paperclip'), element('span', 'tool-label', 'Adjuntar'));
    attachButton.disabled = state.busy;
    attachButton.addEventListener('click', () => fileInput.click());
    bar.append(fileInput, attachButton, quickMenu, aiButton, aiStatus, sendGroup);
  }
  const tray = element('div', 'attach-tray');
  tray.dataset.ticketId = ticket.id;
  if (noteMode) tray.hidden = true;
  else paintAttachTray(tray, ticket.id);
  box.append(slashMenu, tray, textarea, bar);
  if (!noteMode) {
    textarea.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      addAttachments(ticket.id, files);
    });
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
    let dragDepth = 0;
    box.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      box.classList.add('is-dropping');
    });
    box.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    box.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) box.classList.remove('is-dropping');
    });
    box.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      box.classList.remove('is-dropping');
      addAttachments(ticket.id, [...event.dataTransfer.files]);
    });
  }
  form.append(modes, box);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitReply(false);
  });
  if (fillIns()) updateHint();
  const typing = element('div', 'typing-indicator');
  typing.setAttribute('role', 'status');
  typing.setAttribute('aria-live', 'polite');
  fillTyping(typing, ticket.id);
  main.append(typing, form);
  split.append(main);
  if (state.showDetails) split.append(renderClientPanel(ticket, manage));
  panel.append(split);
  return panel;
}

function renderProfile(content) {
  const profile = state.profile;
  const head = element('section', 'overview-hero');
  const intro = element('div', 'overview-intro');
  intro.append(
    element('p', 'eyebrow', 'TU CUENTA'),
    element('h1', '', 'Mi perfil'),
    element('p', 'overview-subtitle', 'Así te ven las personas del equipo y quienes reciben tus respuestas.')
  );
  head.append(intro);
  content.append(head);
  renderFeedback(content);

  if (!profile) {
    content.append(element('p', 'muted empty', 'No pudimos cargar tu perfil. Actualizá la página e intentá de nuevo.'));
    return;
  }

  const card = element('form', 'profile-card');
  const photoColumn = element('div', 'profile-photo');
  const preview = element('div', 'profile-preview');
  const shownName = profile.display_name || state.session?.user?.email || 'UVR';
  let pendingFile = null;
  let removePhoto = false;
  let previewUrl = '';
  const paintPreview = () => {
    const hasPhoto = !removePhoto && (pendingFile || (profile.avatar_path && state.avatarUrls[profile.avatar_path]));
    if (pendingFile && previewUrl) {
      const image = document.createElement('img');
      image.src = previewUrl;
      image.alt = 'Foto elegida';
      preview.replaceChildren(image);
    } else {
      preview.replaceChildren(renderAvatar(shownName, removePhoto ? null : profile.avatar_path, 'xl'));
    }
    preview.classList.toggle('has-photo', Boolean(hasPhoto));
    remove.hidden = !hasPhoto;
    pick.textContent = hasPhoto ? 'Cambiar foto' : 'Subir foto';
  };
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/jpeg,image/png,image/webp';
  file.hidden = true;
  const pick = element('button', 'secondary-button', 'Subir foto');
  pick.type = 'button';
  pick.disabled = state.profileSaving;
  const remove = element('button', 'text-button danger-link', 'Quitar foto');
  remove.type = 'button';
  remove.disabled = state.profileSaving;
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_AVATAR_SOURCE_BYTES) {
      setFeedback('Esa imagen es demasiado grande. Elegí una de hasta 8 MB.');
      renderDashboard();
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    pendingFile = chosen;
    previewUrl = URL.createObjectURL(chosen);
    removePhoto = false;
    paintPreview();
  });
  remove.addEventListener('click', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    pendingFile = null;
    file.value = '';
    removePhoto = true;
    paintPreview();
  });
  photoColumn.append(preview, pick, remove, file, element('p', 'fine-print', 'JPG, PNG o WebP. La recortamos en cuadrado.'));
  paintPreview();

  const fields = element('div', 'profile-fields');
  const nameLabel = element('label', '', 'Nombre visible');
  const nameInput = element('input', 'text-input');
  nameInput.name = 'display_name';
  nameInput.maxLength = 60;
  nameInput.autocomplete = 'name';
  nameInput.placeholder = 'Cómo querés que te vean';
  nameInput.value = profile.display_name || '';
  nameInput.disabled = state.profileSaving;
  nameLabel.append(nameInput);
  const bioLabel = element('label', '', 'Descripción');
  const bioInput = document.createElement('textarea');
  bioInput.className = 'text-input';
  bioInput.name = 'bio';
  bioInput.rows = 4;
  bioInput.maxLength = 280;
  bioInput.placeholder = 'Contá en una línea qué hacés en el equipo.';
  bioInput.value = profile.bio || '';
  bioInput.disabled = state.profileSaving;
  const counter = element('span', 'field-counter', `${bioInput.value.length}/280`);
  bioInput.addEventListener('input', () => { counter.textContent = `${bioInput.value.length}/280`; });
  bioLabel.append(bioInput, counter);
  const facts = element('dl', 'profile-facts');
  [
    ['Correo', state.session?.user?.email || profile.email],
    ['Rol', profile.role === 'owner' ? 'Propietario' : 'Agente'],
    ['En el equipo desde', formatMonthYear(profile.created_at)],
  ].forEach(([label, value]) => {
    const row = element('div', '');
    row.append(element('dt', '', label), element('dd', '', value));
    facts.append(row);
  });
  const save = element('button', 'primary-button', state.profileSaving ? 'Guardando…' : 'Guardar cambios');
  save.type = 'submit';
  save.disabled = state.profileSaving;
  fields.append(nameLabel, bioLabel, facts, save);
  card.append(photoColumn, fields);
  card.addEventListener('submit', (event) => {
    event.preventDefault();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    void saveProfile({
      displayName: nameInput.value,
      bio: bioInput.value,
      file: pendingFile,
      removePhoto,
    });
  });
  content.append(card);
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
    renderAgentMetric('Accesos activos', activeAgents.length, 'Personas habilitadas', 'team-metric-active', 'shield'),
    renderAgentMetric('Disponibles', availableAgents.length, 'Pueden recibir tickets', 'team-metric-ready', 'check'),
    renderAgentMetric('En pausa', activeAgents.length - availableAgents.length, 'Sin nuevas asignaciones', 'team-metric-paused', 'pause'),
    renderAgentMetric('Casos activos', activeTickets, 'Asignados al equipo', 'team-metric-tickets', 'ticket')
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
    const member = teamMember(agent.user_id);
    const initialsText = member?.display_name
      ? initials(member.display_name)
      : agent.email?.split('@')[0]?.slice(0, 2).toLocaleUpperCase('es-AR') || 'UV';
    identity.append(member?.avatar_path && state.avatarUrls[member.avatar_path]
      ? renderAvatar(memberName(member), member.avatar_path, 'md')
      : element('span', 'agent-card-avatar', initialsText));
    const details = element('div', 'agent-card-details');
    const shownName = member?.display_name || agent.email;
    const name = element('strong', 'agent-email', owner ? `${shownName} · Vos` : shownName);
    const meta = element('div', 'agent-card-meta');
    if (member?.display_name) meta.append(element('span', 'agent-mail', agent.email));
    meta.append(element('span', `agent-role${owner ? ' is-owner' : ''}`, owner ? 'Propietario' : 'Agente'));
    if (!owner) {
      const status = !agent.active ? 'Acceso deshabilitado' : agent.available ? 'Disponible' : 'En pausa';
      meta.append(element('span', `agent-state${!agent.active ? ' is-disabled' : agent.available ? ' is-available' : ' is-paused'}`, status));
    }
    details.append(name, meta);
    if (member?.bio) details.append(element('span', 'agent-bio', member.bio));
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

function renderAgentMetric(label, value, detail, accent, iconName = 'users') {
  const card = element('article', `team-metric ${accent}`);
  const top = element('div', 'stat-top');
  const chip = element('span', 'stat-icon');
  chip.append(icon(iconName));
  top.append(element('span', 'team-metric-label', label), chip);
  card.append(
    top,
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

async function resolveAvatarUrls() {
  const paths = [...new Set([state.profile?.avatar_path, ...Object.values(state.team).map((member) => member.avatar_path)].filter(Boolean))];
  const stale = Date.now() - state.avatarUrlsAt > AVATAR_URL_REFRESH_MS;
  if (!paths.length || (!stale && paths.every((path) => state.avatarUrls[path]))) return false;
  const { data, error } = await state.supabase.storage.from('support-avatars').createSignedUrls(paths, AVATAR_URL_TTL_SECONDS);
  if (error || !data) return false;
  state.avatarUrls = Object.fromEntries(data.filter((item) => item.signedUrl).map((item) => [item.path, item.signedUrl]));
  state.avatarUrlsAt = Date.now();
  return true;
}

async function loadTeam() {
  if (!state.authorized) return;
  const userId = state.session?.user?.id;
  const [teamResult, profileResult] = await Promise.all([
    state.supabase.rpc('support_team_directory'),
    state.supabase.rpc('my_support_profile'),
  ]);
  if (userId !== state.session?.user?.id || !state.authorized) return;
  if (!teamResult.error) state.team = Object.fromEntries((teamResult.data || []).map((member) => [member.user_id, member]));
  if (!profileResult.error) state.profile = profileResult.data?.[0] ?? null;
  await resolveAvatarUrls();
}

async function loadClientContext(ticketId) {
  const userId = state.session?.user?.id;
  const { data, error } = await state.supabase.rpc('support_ticket_client_context', { p_ticket_id: ticketId });
  if (userId !== state.session?.user?.id || !state.authorized) return;
  state.clientContexts[ticketId] = error ? null : data;
  if (state.page === 'tickets' && state.selectedId === ticketId && !isTypingInApp()) renderDashboard();
}

function userError(message) {
  const error = new Error(message);
  error.userMessage = message;
  return error;
}

// Las fotos se achican a 1600 px y se pasan a WebP antes de subir: llegan rápido y pesan poco.
function prepareAttachmentImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, ATTACH_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const encode = (type, quality) => new Promise((done) => canvas.toBlob(done, type, quality));
      context.drawImage(image, 0, 0, width, height);
      encode('image/webp', 0.85).then(async (webp) => {
        let blob = webp;
        // Algunos Safari no codifican WebP y devuelven PNG: en ese caso va JPG con fondo blanco.
        if (!blob || blob.type !== 'image/webp') {
          context.globalCompositeOperation = 'destination-over';
          context.fillStyle = '#fff';
          context.fillRect(0, 0, width, height);
          blob = await encode('image/jpeg', 0.86);
        }
        if (!blob) reject(userError('No pudimos procesar la imagen.'));
        else resolve({ blob, width, height, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' });
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(userError('No pudimos leer esa imagen. Probá con otra.'));
    };
    image.src = objectUrl;
  });
}

function paintAttachTray(tray, ticketId) {
  const items = state.uploads[ticketId] || [];
  tray.hidden = !items.length;
  tray.replaceChildren(...items.map((item) => {
    const chip = element('div', `attach-chip is-${item.status}${item.preview ? ' has-thumb' : ''}`);
    chip.setAttribute('role', 'group');
    chip.setAttribute('aria-label', item.name);
    const thumb = element('span', 'attach-chip-thumb');
    if (item.preview) {
      const image = document.createElement('img');
      image.src = item.preview;
      image.alt = '';
      thumb.append(image);
    } else thumb.append(icon('file'));
    const text = element('span', 'attach-chip-text');
    const detail = item.status === 'uploading'
      ? 'Subiendo…'
      : item.status === 'error' ? item.error : formatBytes(item.size);
    text.append(element('strong', '', item.name), element('span', '', detail));
    const remove = element('button', 'attach-chip-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Quitar ${item.name}`);
    remove.title = 'Quitar';
    remove.append(icon('close'));
    remove.addEventListener('click', () => removeAttachment(ticketId, item));
    chip.append(thumb, text, remove);
    return chip;
  }));
}

function refreshAttachTray(ticketId) {
  const tray = app.querySelector(`.attach-tray[data-ticket-id="${ticketId}"]`);
  if (tray && !app.querySelector('.composer.is-note')) paintAttachTray(tray, ticketId);
}

function addAttachments(ticketId, files) {
  const list = state.uploads[ticketId] || (state.uploads[ticketId] = []);
  const problems = new Set();
  files.forEach((file) => {
    const isPdf = file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name || ''));
    if (!isPdf && !ATTACH_IMAGE_TYPES.includes(file.type)) {
      problems.add('Solo podés adjuntar imágenes JPG, PNG o WebP y archivos PDF.');
      return;
    }
    if (file.size > ATTACH_MAX_BYTES) {
      problems.add('Cada archivo puede pesar hasta 10 MB.');
      return;
    }
    if (list.length >= ATTACH_MAX_FILES) {
      problems.add(`Podés adjuntar hasta ${ATTACH_MAX_FILES} archivos por mensaje.`);
      return;
    }
    const item = {
      id: crypto.randomUUID(),
      name: (file.name || (isPdf ? 'Documento.pdf' : 'Imagen')).slice(0, 120),
      mime: isPdf ? 'application/pdf' : 'image/webp',
      size: file.size,
      status: 'uploading',
      path: '',
      preview: isPdf ? '' : URL.createObjectURL(file),
      width: 0,
      height: 0,
    };
    list.push(item);
    void uploadAttachment(ticketId, item, file);
  });
  if (problems.size) showToast([...problems].join(' '), '', null, 6000);
  refreshAttachTray(ticketId);
  app.querySelector('.reply-input')?.focus();
}

async function uploadAttachment(ticketId, item, file) {
  const userId = state.session?.user?.id;
  try {
    let blob = file;
    let ext = 'pdf';
    if (item.mime !== 'application/pdf') {
      const prepared = await prepareAttachmentImage(file);
      ({ blob, ext } = prepared);
      Object.assign(item, { mime: blob.type, size: blob.size, width: prepared.width, height: prepared.height });
    }
    const path = `${ticketId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await state.supabase.storage
      .from(ATTACH_BUCKET)
      .upload(path, blob, { contentType: item.mime, cacheControl: '3600' });
    if (error) throw error;
    // Si mientras subía lo quitaron o cambió la sesión, el archivo no se usa.
    if (userId !== state.session?.user?.id || !state.uploads[ticketId]?.includes(item)) {
      void state.supabase.storage.from(ATTACH_BUCKET).remove([path]);
      return;
    }
    item.path = path;
    item.status = 'ready';
  } catch (error) {
    item.status = 'error';
    item.error = userFacingError(error, 'No se pudo subir. Quitalo y probá de nuevo.');
  }
  refreshAttachTray(ticketId);
}

function removeAttachment(ticketId, item) {
  state.uploads[ticketId] = (state.uploads[ticketId] || []).filter((entry) => entry !== item);
  if (!state.uploads[ticketId].length) delete state.uploads[ticketId];
  if (item.path) void state.supabase.storage.from(ATTACH_BUCKET).remove([item.path]);
  if (item.preview) URL.revokeObjectURL(item.preview);
  refreshAttachTray(ticketId);
  app.querySelector('.reply-input')?.focus();
}

function prepareAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(userError('Elegí una imagen JPG, PNG o WebP.'));
      return;
    }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      canvas.getContext('2d').drawImage(
        image,
        (image.naturalWidth - side) / 2,
        (image.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        AVATAR_SIZE,
        AVATAR_SIZE
      );
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(userError('No pudimos procesar la imagen.'))), 'image/jpeg', 0.86);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(userError('No pudimos leer esa imagen. Probá con otra.'));
    };
    image.src = objectUrl;
  });
}

async function saveProfile({ displayName, bio, file, removePhoto }) {
  const userId = state.session?.user?.id;
  const previousPath = state.profile?.avatar_path || null;
  let avatarPath = removePhoto ? null : previousPath;
  state.profileSaving = true;
  setFeedback();
  renderDashboard();
  try {
    if (file) {
      const blob = await prepareAvatar(file);
      avatarPath = `${userId}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await state.supabase.storage
        .from('support-avatars')
        .upload(avatarPath, blob, { contentType: 'image/jpeg', cacheControl: '3600' });
      if (uploadError) throw uploadError;
    }
    const { error } = await state.supabase.rpc('update_my_support_profile', {
      p_display_name: displayName,
      p_bio: bio,
      p_avatar_path: avatarPath,
    });
    if (error) {
      if (file) await state.supabase.storage.from('support-avatars').remove([avatarPath]);
      throw error;
    }
    if (previousPath && previousPath !== avatarPath) await state.supabase.storage.from('support-avatars').remove([previousPath]);
    if (userId !== state.session?.user?.id) return;
    state.avatarUrlsAt = 0;
    await loadTeam();
    setFeedback('', 'Guardamos tu perfil.');
  } catch (error) {
    if (userId !== state.session?.user?.id) return;
    setFeedback(userFacingError(error, 'No pudimos guardar tu perfil. Probá de nuevo.'));
  } finally {
    state.profileSaving = false;
  }
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
  await Promise.all([loadTickets(), loadAgents(), loadDashboardStats(), state.selectedId === ticketId ? loadMessages(ticketId) : null]);
}

async function claimTicket(ticketId) {
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('claim_support_ticket', { p_ticket_id: ticketId });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos tomar el ticket. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  setFeedback('', 'Tomaste el ticket.');
  await Promise.all([loadTickets(), loadAgents(), loadDashboardStats(), state.selectedId === ticketId ? loadMessages(ticketId) : null]);
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

function renderStatCard(label, value, detail, accent = '', iconName = 'ticket') {
  const card = element('article', `stat-card${accent ? ` ${accent}` : ''}`);
  const top = element('div', 'stat-top');
  const chip = element('span', 'stat-icon');
  chip.append(icon(iconName));
  top.append(element('span', 'stat-label', label), chip);
  card.append(top);
  card.append(element('strong', 'stat-value', Number(value || 0).toLocaleString('es-AR')));
  card.append(element('span', 'stat-detail', detail));
  return card;
}

function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 13) return 'Buen día';
  if (hour >= 13 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
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
  const sectionHeading = element('div', 'section-heading');
  const title = element('div', '');
  title.append(element('h2', '', 'Estado de la bandeja'));
  title.append(element('p', 'muted', 'Cómo se distribuyen los tickets que tenés a la vista.'));
  sectionHeading.append(title);
  section.append(sectionHeading);
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
  const hero = element('section', 'overview-hero overview-banner');
  const introduction = element('div', 'overview-intro');
  const rawName = String(state.profile?.display_name || '').trim();
  const firstName = rawName.includes('@') ? '' : rawName.split(/\s+/)[0];
  const today = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const pending = Number(stats?.active) || 0;
  const unassigned = state.role === 'owner' ? Number(stats?.unassigned) || 0 : 0;
  let summary = 'Cargando cómo viene el día…';
  if (stats) {
    summary = pending
      ? `${pending} ${pending === 1 ? 'ticket necesita' : 'tickets necesitan'} atención${unassigned ? ` y ${unassigned} ${unassigned === 1 ? 'espera' : 'esperan'} asignación` : ''}.`
      : 'Bandeja al día. No hay tickets que requieran atención.';
  }
  const meta = element('div', 'banner-meta');
  meta.append(element('span', 'banner-date', today));
  const live = element('span', `live-pill${state.liveOk ? ' is-live' : ''}`);
  live.append(element('span', 'live-pill-dot'), element('span', '', state.liveOk ? 'En vivo' : 'Sincronizando'));
  meta.append(live);
  introduction.append(
    meta,
    element('h1', '', firstName ? `${greetingFor()}, ${firstName}` : greetingFor()),
    element('p', 'overview-subtitle', summary)
  );
  const actions = element('div', 'banner-actions');
  const goInbox = element('button', 'banner-primary');
  goInbox.type = 'button';
  goInbox.append(icon('inbox'), element('span', '', 'Ir a la bandeja'), icon('arrow', 'banner-arrow'));
  goInbox.addEventListener('click', () => navigateTo('tickets'));
  const refresh = element('button', 'overview-refresh');
  refresh.type = 'button';
  refresh.title = 'Actualizar';
  refresh.setAttribute('aria-label', 'Actualizar');
  refresh.append(icon('refresh'));
  refresh.disabled = state.busy;
  refresh.addEventListener('click', refreshDashboard);
  actions.append(goInbox, refresh);
  hero.append(introduction, actions);
  content.append(hero);
  if (shouldOfferNotify()) content.append(renderNotifyOffer());
  renderFeedback(content);

  if (!stats) {
    content.append(renderOverviewSkeleton());
    return;
  }

  const activeTickets = Number(stats.active) || 0;
  const metrics = element('section', 'overview-metrics');
  metrics.append(
    renderStatCard('Tickets en tu bandeja', stats.total, `${Number(stats.created_today) || 0} nuevos hoy`, 'stat-total', 'ticket'),
    renderStatCard('Requieren atención', activeTickets, `${Number(stats.open) || 0} sin revisar`, 'stat-active', 'bolt'),
    renderStatCard('Esperando respuesta', stats.waiting_on_user, 'Pendientes del usuario', 'stat-waiting', 'clock'),
    renderStatCard('Nuevos en 7 días', stats.created_last_7_days, 'Última semana', 'stat-new', 'trend')
  );
  if (state.role === 'owner') {
    metrics.append(renderStatCard('Sin asignar', stats.unassigned, 'En la cola general', 'stat-unassigned', 'queue'));
  } else {
    metrics.classList.add('is-four');
  }
  content.append(metrics);

  if (state.role === 'agent') content.append(renderAgentAvailability(stats));

  const recent = element('section', 'overview-card recent-card');
  const recentHeading = element('div', 'section-heading');
  const recentTitle = element('div', '');
  recentTitle.append(element('h2', '', 'Actividad reciente'));
  recentTitle.append(element('p', 'muted', 'Las últimas conversaciones con movimiento.'));
  const allTickets = element('button', 'text-button section-link', 'Ver bandeja');
  allTickets.type = 'button';
  allTickets.append(icon('arrow'));
  allTickets.addEventListener('click', () => navigateTo('tickets'));
  recentHeading.append(recentTitle, allTickets);
  recent.append(recentHeading);
  const recentList = element('div', 'recent-list');
  if (state.tickets.length) {
    state.tickets.slice(0, 5).forEach((ticket) => recentList.append(renderRecentRow(ticket)));
  } else {
    recentList.append(element('p', 'empty', 'Todavía no hay tickets para mostrar.'));
  }
  recent.append(recentList);

  const primary = element('div', 'overview-grid');
  primary.append(recent, renderStatusBreakdown(stats));
  content.append(primary);

  const volume = element('section', 'overview-card volume-card');
  const volumeHeading = element('div', 'section-heading');
  const volumeTitle = element('div', '');
  volumeTitle.append(element('h2', '', 'Ritmo de tickets'));
  volumeTitle.append(element('p', 'muted', 'Tickets creados durante los últimos 7 días.'));
  volumeHeading.append(volumeTitle, element('span', 'chart-period', '7 DÍAS'));
  volume.append(volumeHeading, renderDailyChart(stats.daily));
  const secondary = element('div', state.role === 'owner' ? 'overview-grid' : 'overview-grid is-single');
  secondary.append(volume);
  if (state.role === 'owner') secondary.append(renderAgentWorkload(stats));
  content.append(secondary);
}

function renderRecentRow(ticket) {
  const row = element('button', 'recent-row');
  row.type = 'button';
  const main = element('span', 'recent-main');
  main.append(element('strong', '', ticket.client_name), element('span', '', ticket.subject));
  const side = element('span', 'recent-side');
  side.append(
    element('span', `status status-${ticket.status}`, statusNames[ticket.status] || ticket.status),
    element('time', '', formatAge(ticket.last_message_at))
  );
  row.append(renderAvatar(ticket.client_name), main, side);
  row.addEventListener('click', () => selectTicket(ticket.id));
  return row;
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
  const requests = [loadDashboardStats(), loadTickets(), loadTeam()];
  if (state.role === 'owner') requests.push(loadAgents());
  await Promise.all(requests);
}

function routeFromHash() {
  const match = /^#\/(tickets|agents|profile)(?:\/([0-9a-f-]{36}))?$/i.exec(window.location.hash);
  if (!match) return { page: 'overview', ticketId: null };
  return { page: match[1].toLowerCase(), ticketId: match[2] || null };
}

function routeHash() {
  if (state.page === 'tickets') return state.selectedId ? `#/tickets/${state.selectedId}` : '#/tickets';
  if (state.page === 'profile') return '#/profile';
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
  state.activity = [];
  state.threadFor = null;
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
  state.error = '';
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
  state.activity = [];
  state.threadFor = null;
  renderDashboard();
  if (state.page === 'tickets' && state.selectedId) void loadMessages(state.selectedId);
});

function renderDashboard() {
  // Al reemplazar el menú, el navegador cierra el popover de avisos sin disparar "toggle".
  notifyMenuOpen = false;
  if (!state.authorized) return renderUnauthorized();
  state.live?.setTicket(state.page === 'tickets' ? state.selectedId : null);
  const shell = element('div', state.page === 'tickets' ? 'dashboard is-inbox' : 'dashboard');
  const header = element('header', 'app-header');
  const brand = element('div', 'header-brand');
  brand.append(element('div', 'brand-mark small-mark', 'UVR'));
  const brandText = element('div', '');
  brandText.append(element('strong', '', 'UVR Home'), element('span', 'muted', 'Soporte'));
  brand.append(brandText);
  const account = element('div', 'header-account');
  const cmdButton = element('button', 'cmd-button');
  cmdButton.type = 'button';
  cmdButton.setAttribute('aria-label', 'Abrir la paleta de comandos');
  cmdButton.append(icon('search', 'cmd-icon'), element('span', 'cmd-label', 'Buscar o ejecutar…'), element('kbd', '', 'Ctrl K'));
  cmdButton.addEventListener('click', () => openPalette(buildCommands));
  const myName = state.profile?.display_name || state.session?.user?.email || 'Agente';
  const accountCard = element('div', 'account-card');
  const me = element('button', `account-chip${state.page === 'profile' ? ' active' : ''}`);
  me.type = 'button';
  me.title = 'Mi perfil';
  me.setAttribute('aria-label', `Mi perfil: ${myName}`);
  if (state.page === 'profile') me.setAttribute('aria-current', 'page');
  const meText = element('span', 'account-meta');
  meText.append(
    element('span', 'account-name', myName),
    element('span', 'account-role', state.role === 'owner' ? 'Propietario' : 'Agente de soporte')
  );
  me.append(renderAvatar(myName, state.profile?.avatar_path, 'sm'), meText);
  me.addEventListener('click', () => navigateTo('profile'));
  const logout = element('button', 'logout-button');
  logout.type = 'button';
  logout.title = 'Cerrar sesión';
  logout.setAttribute('aria-label', 'Cerrar sesión');
  logout.append(icon('logout'));
  logout.addEventListener('click', signOut);
  const dark = currentTheme() === 'dark';
  const themeButton = element('button', 'logout-button theme-button');
  themeButton.type = 'button';
  themeButton.title = dark ? 'Usar tema claro' : 'Usar tema oscuro';
  themeButton.setAttribute('aria-label', themeButton.title);
  themeButton.append(icon(dark ? 'sun' : 'moon'));
  themeButton.addEventListener('click', toggleTheme);
  accountCard.append(me, themeButton, logout);
  const notifyControl = renderNotifyControl();
  if (notifyControl) account.append(notifyControl);
  account.append(cmdButton, accountCard);
  const nav = element('nav', 'header-nav');
  nav.setAttribute('aria-label', 'Secciones');
  const navButton = (page, label, iconName) => {
    const button = element('button', state.page === page ? 'nav-button active' : 'nav-button');
    button.type = 'button';
    button.title = label;
    button.append(icon(iconName, 'nav-icon'), element('span', 'nav-label', label));
    if (state.page === page) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => navigateTo(page));
    nav.append(button);
    return button;
  };
  navButton('overview', 'Resumen', 'overview');
  const tickets = navButton('tickets', 'Tickets', 'inbox');
  const openCount = Number(state.dashboardStats?.open || 0);
  if (openCount) {
    tickets.append(element('span', 'nav-badge', openCount > 99 ? '99+' : String(openCount)));
    tickets.setAttribute('aria-label', `Tickets, ${openCount} ${openCount === 1 ? 'abierto' : 'abiertos'}`);
  }
  if (state.role === 'owner') navButton('agents', 'Usuarios', 'users');
  header.append(brand, element('span', 'nav-caption', 'MENÚ'), nav, account);
  shell.append(header);

  const content = element('main', 'dashboard-main');
  content.tabIndex = -1;
  if (state.role === 'owner' && state.page === 'agents') {
    renderAgentManagement(content);
    shell.append(content);
    app.replaceChildren(shell);
    return;
  }
  if (state.page === 'profile') {
    renderProfile(content);
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
  const inboxHeading = element('div', 'inbox-heading');
  const inboxTitle = element('div', '');
  const total = state.ticketTotal || state.tickets.length;
  const loadingTickets = !state.ticketsLoaded && !state.ticketsFailed;
  inboxTitle.append(
    element('h1', '', 'Bandeja'),
    element('p', '', loadingTickets
      ? 'Cargando conversaciones…'
      : `${total.toLocaleString('es-AR')} ${total === 1 ? 'conversación' : 'conversaciones'}`)
  );
  inboxHeading.append(inboxTitle);
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
  const refresh = element('button', 'icon-button');
  refresh.append(icon('refresh'));
  refresh.type = 'button';
  refresh.setAttribute('aria-label', 'Actualizar tickets');
  refresh.title = 'Actualizar';
  refresh.addEventListener('click', loadTickets);
  searchRow.append(search, refresh);

  const pills = element('div', 'filter-pills');
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Filtrar por estado');
  const countFor = (value) => (value === 'all'
    ? state.tickets.length
    : state.tickets.filter((ticket) => (value === 'unassigned' ? !ticket.assigned_agent_id : ticket.status === value)).length);
  const filterLabel = Object.fromEntries(ticketFilters);
  const primaryFilters = [['all', 'Todos'], ['open', filterLabel.open], ['waiting_on_user', filterLabel.waiting_on_user]];
  const moreFilters = [['unassigned', 'Sin asignar'], ...ticketFilters.filter(([value]) => !primaryFilters.some(([primary]) => primary === value))];
  primaryFilters.forEach(([value, label]) => {
    const count = countFor(value);
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
  const more = document.createElement('select');
  const moreActive = moreFilters.some(([value]) => value === state.filter);
  more.className = `pill pill-select${moreActive ? ' is-active' : ''}`;
  more.setAttribute('aria-label', 'Más estados');
  const moreLabel = document.createElement('option');
  moreLabel.value = '';
  moreLabel.textContent = 'Más';
  more.append(moreLabel);
  moreFilters.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    const count = countFor(value);
    option.textContent = count ? `${label} · ${count}` : label;
    more.append(option);
  });
  more.value = moreActive ? state.filter : '';
  more.addEventListener('change', () => {
    state.filter = more.value || 'all';
    renderDashboard();
  });
  const filterRow = element('div', 'filter-row');
  filterRow.append(pills, more);
  tools.append(searchRow, filterRow);

  const list = element('div', 'ticket-list');
  list.setAttribute('aria-label', 'Bandeja de tickets');
  const listHeading = element('div', 'list-heading');
  listHeading.setAttribute('aria-live', 'polite');
  listHeading.setAttribute('aria-atomic', 'true');
  renderTicketResults(list, listHeading);
  listPanel.append(inboxHeading, tools, list);
  columns.append(listPanel);

  const selected = state.tickets.find((ticket) => ticket.id === state.selectedId);
  if (selected) {
    shell.classList.add('has-ticket');
    columns.append(renderDetail(selected));
  } else if (state.selectedId && !state.ticketsLoaded && !state.ticketsFailed) {
    shell.classList.add('has-ticket');
    columns.append(renderDetailSkeleton());
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
    void resolveAttachmentUrls();
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
  if (!state.ticketsLoaded && !state.ticketsFailed) {
    heading.replaceChildren(element('span', '', 'Cargando tickets…'));
    list.setAttribute('aria-busy', 'true');
    for (let index = 0; index < 6; index += 1) list.append(renderTicketRowSkeleton(index));
    return;
  }
  list.removeAttribute('aria-busy');
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
    state.ticketsFailed = !state.ticketsLoaded;
    setFeedback(userFacingError(error, 'No pudimos cargar los tickets. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  state.tickets = data || [];
  state.ticketTotal = count ?? state.tickets.length;
  state.ticketsLoaded = true;
  state.ticketsFailed = false;
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

function insertQuickReply(ticketId, text) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  const filled = fillVariables(text, ticket);
  const current = (state.drafts[ticketId] || '').trim();
  state.drafts[ticketId] = current ? `${current}\n\n${filled}` : filled;
  saveDrafts();
  state.composerMode = 'reply';
  renderDashboard();
  const area = app.querySelector('.reply-input');
  area?.focus();
  area?.setSelectionRange(area.value.length, area.value.length);
}

function buildCommands() {
  const myId = state.session?.user?.id;
  const items = [
    { group: 'Ir a', label: 'Resumen', keywords: 'inicio panel', featured: true, run: () => navigateTo('overview') },
    { group: 'Ir a', label: 'Tickets', keywords: 'bandeja consultas', featured: true, run: () => navigateTo('tickets') },
    { group: 'Ir a', label: 'Mi perfil', keywords: 'foto nombre descripcion cuenta', featured: true, run: () => navigateTo('profile') },
  ];
  if (state.role === 'owner') {
    items.splice(2, 0, { group: 'Ir a', label: 'Usuarios', keywords: 'equipo agentes invitar', featured: true, run: () => navigateTo('agents') });
  }
  ticketFilters.concat([['unassigned', 'Sin asignar'], ['all', 'Todos']]).forEach(([value, label]) => {
    items.push({
      group: 'Filtrar tickets',
      label: `Ver ${label.toLocaleLowerCase('es-AR')}`,
      keywords: 'filtro bandeja',
      run: () => {
        state.filter = value;
        state.selectedId = null;
        state.page = 'tickets';
        syncRoute();
        renderDashboard();
      },
    });
  });
  const ticket = state.page === 'tickets' ? state.tickets.find((item) => item.id === state.selectedId) : null;
  if (ticket) {
    const canTake = ticket.assigned_agent_id !== myId
      && !['resolved', 'closed'].includes(ticket.status)
      && (state.role === 'owner' || !ticket.assigned_agent_id);
    if (canTake) items.push({ group: 'Este ticket', label: 'Tomar ticket', keywords: 'asignarme quedarme', featured: true, run: () => claimTicket(ticket.id) });
    items.push(
      { group: 'Este ticket', label: 'Escribir nota interna', hint: 'N', keywords: 'nota privada equipo susurro whisper', featured: true, run: () => setComposerMode('note') },
      { group: 'Este ticket', label: 'Responder al cliente', hint: 'R', keywords: 'responder mensaje escribir', run: () => setComposerMode('reply') }
    );
    statuses.filter(([value]) => value !== ticket.status).forEach(([value, label]) => {
      items.push({ group: 'Este ticket', label: `Marcar como: ${label}`, keywords: 'estado cambiar', featured: value === 'resolved', run: () => updateStatus(ticket.id, value) });
    });
    quickReplies.forEach(([name, text, slug]) => {
      items.push({ group: 'Respuestas rápidas', label: name, hint: `/${slug}`, keywords: `responder ${text}`, run: () => insertQuickReply(ticket.id, text) });
    });
  }
  state.tickets.forEach((item) => {
    items.push({
      group: 'Tickets',
      label: item.subject,
      hint: `${item.client_name} · ${statusNames[item.status] || item.status}`,
      keywords: `${item.client_name} ${item.id} ${typeNames[item.ticket_type] || ''}`,
      run: () => selectTicket(item.id),
    });
  });
  items.push(
    ...notifyCommands(),
    { group: 'Cuenta', label: 'Ver atajos de teclado', keywords: 'ayuda teclas', run: () => showToast('J / K: ticket siguiente o anterior · R: responder · N: nota interna · /: buscar · Esc: cerrar ticket · Ctrl K: paleta', '', null, 15000) },
    { group: 'Cuenta', label: currentTheme() === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro', keywords: 'modo noche oscuro claro apariencia tema', run: toggleTheme },
    { group: 'Cuenta', label: 'Salir', keywords: 'cerrar sesion logout', run: signOut }
  );
  return items;
}

function stepTicket(direction) {
  const rows = [...app.querySelectorAll('.ticket-row')];
  if (!rows.length) return;
  const current = rows.findIndex((row) => row.dataset.ticketId === state.selectedId);
  const next = rows[Math.min(rows.length - 1, Math.max(0, current + direction))];
  if (!next || next.dataset.ticketId === state.selectedId) return;
  next.click();
  app.querySelector('.ticket-row.selected')?.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (event) => {
  if (!state.authorized) return;
  // Con el visor abierto, las teclas son suyas (flechas y Esc) y no deben mover nada detrás.
  if (document.querySelector('dialog.viewer[open]')) return;
  // El menú de avisos se cierra solo con Esc; el resto de los atajos no aplica mientras está abierto.
  if (isNotifyMenuOpen()) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (isPaletteOpen()) closePalette();
    else openPalette(buildCommands);
    return;
  }
  if (isPaletteOpen() || event.ctrlKey || event.metaKey || event.altKey || state.page !== 'tickets') return;
  const openMenu = app.querySelector('details.quick-menu[open]');
  if (event.key === 'Escape' && openMenu) {
    openMenu.open = false;
    openMenu.querySelector('summary')?.focus();
    return;
  }
  if (event.key === 'Escape' && state.showDetails && !isWideDetails()) {
    state.showDetails = false;
    renderDashboard();
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))) {
    if (!(target.tagName === 'BUTTON' && target.classList.contains('ticket-row'))) return;
  }
  if (event.key === 'j') stepTicket(1);
  else if (event.key === 'k') stepTicket(-1);
  else if ((event.key === 'n' || event.key === 'r') && state.selectedId) {
    event.preventDefault();
    setComposerMode(event.key === 'n' ? 'note' : 'reply');
  } else if (event.key === '/') {
    event.preventDefault();
    app.querySelector('.ticket-search')?.focus();
  } else if (event.key === 'Escape' && state.selectedId) closeTicket();
});

document.addEventListener('click', (event) => {
  app.querySelectorAll('details.quick-menu[open]').forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});

window.matchMedia('(min-width: 1280px)').addEventListener('change', () => {
  const next = readDetailsPref();
  if (next === state.showDetails) return;
  state.showDetails = next;
  if (state.authorized && state.page === 'tickets' && state.selectedId) renderDashboard();
});

async function pollSupport() {
  // Con la pestaña oculta solo sondeamos si el agente activó los avisos de escritorio.
  if (!state.authorized || state.busy || (document.hidden && notifyStatus() !== 'on') || state.page === 'agents') return;
  if (state.polling) {
    state.pollQueued = true;
    return;
  }
  state.polling = true;
  state.lastPollAt = Date.now();
  const userId = state.session?.user?.id;
  const previous = new Map(state.tickets.map((ticket) => [ticket.id, ticket]));
  const previousLatest = state.tickets.reduce((latest, ticket) => Math.max(latest, new Date(ticket.created_at).getTime()), 0);
  try {
    const [page, stats, mentions] = await Promise.all([
      fetchTicketPage(state.ticketLimit),
      state.supabase.rpc('support_dashboard_stats'),
      fetchNewMentions(userId),
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
    const assignedToMe = state.ticketsLoaded
      ? tickets.filter((ticket) => {
        const before = previous.get(ticket.id);
        return before && before.assigned_agent_id !== userId && ticket.assigned_agent_id === userId;
      })
      : [];
    state.tickets = tickets;
    state.ticketTotal = page.count ?? tickets.length;
    state.ticketsLoaded = true;
    if (state.selectedId && !tickets.some((ticket) => ticket.id === state.selectedId)) state.selectedId = null;
    // La actividad (notas, estados, asignaciones) no mueve last_message_at: el hilo abierto se refresca siempre.
    if (state.selectedId) {
      const ticketId = state.selectedId;
      const thread = await fetchThread(ticketId);
      if (!thread.error && userId === state.session?.user?.id && state.selectedId === ticketId) {
        state.messages = thread.messages;
        state.activity = thread.activity;
        state.threadFor = ticketId;
        state.threadError = null;
      }
    }
    await resolveAvatarUrls();
    notifyDesktop({ fresh, replies, assignedToMe, mentions, userId });
    if (fresh.length || replies.length || mentions.length) {
      state.unseenTickets += fresh.length + replies.length + mentions.length;
      updateDocumentTitle();
      const parts = [];
      if (fresh.length) parts.push(`${fresh.length} ${fresh.length === 1 ? 'ticket nuevo' : 'tickets nuevos'}`);
      if (replies.length) parts.push(`${replies.length} ${replies.length === 1 ? 'respuesta de usuario' : 'respuestas de usuarios'}`);
      if (mentions.length) parts.push(`${mentions.length === 1 ? 'Te mencionaron en una nota' : `Te mencionaron en ${mentions.length} notas`}`);
      const onlyMention = !fresh.length && !replies.length && mentions.length === 1;
      showToast(parts.join(' · '), onlyMention ? 'Ver nota' : state.page === 'tickets' ? '' : 'Ver tickets', () => {
        if (onlyMention) {
          openTicketFromNotice(mentions[0].ticket_id);
          return;
        }
        state.filter = 'open';
        state.ticketSort = 'urgent';
        navigateTo('tickets');
      });
    }
    const list = app.querySelector('.ticket-list');
    if (isTypingInApp() && list && state.page === 'tickets') {
      renderTicketResults(list, list.querySelector('.list-heading') || element('div', 'list-heading'));
    } else if (!isTypingInApp() && !isNotifyMenuOpen() && state.page !== 'profile') {
      renderDashboard();
    }
  } finally {
    state.polling = false;
    if (state.pollQueued) {
      state.pollQueued = false;
      void pollSupport();
    }
  }
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = window.setInterval(() => {
    if (state.liveOk && Date.now() - state.lastPollAt < LIVE_FALLBACK_MS) return;
    void pollSupport();
  }, POLL_INTERVAL_MS);
}

// Formas en que el equipo puede mencionarme en una nota: @Nombre, @NombreApellido o @usuario-del-correo.
function myMentionHandles() {
  const name = String(state.profile?.display_name || '').trim();
  const handles = new Set();
  if (name && !name.includes('@')) {
    handles.add(foldText(firstWord(name)));
    handles.add(foldText(name.replace(/\s+/g, '')));
  }
  const mailbox = state.session?.user?.email?.split('@')[0];
  if (mailbox) handles.add(foldText(mailbox));
  handles.delete('');
  return handles;
}

function mentionsMe(body, handles) {
  if (!handles.size) return false;
  return [...String(body || '').matchAll(/@([\p{L}\p{N}_.-]+)/gu)]
    .some(([, handle]) => handles.has(foldText(handle.replace(/[.-]+$/, ''))));
}

// Notas nuevas de otros que me mencionan. La primera consulta solo fija el punto de partida.
async function fetchNewMentions(userId) {
  if (!userId) return [];
  const query = state.supabase
    .from('support_ticket_activity')
    .select('id, ticket_id, actor_id, body, created_at')
    .eq('kind', 'note')
    .neq('actor_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  const since = state.mentionsSince;
  if (since) query.gt('created_at', since);
  const { data, error } = await query;
  if (error || userId !== state.session?.user?.id) return [];
  const notes = data || [];
  if (notes.length) state.mentionsSince = notes[0].created_at;
  else if (!since) state.mentionsSince = new Date(0).toISOString();
  if (!since) return [];
  const handles = myMentionHandles();
  return notes.filter((note) => mentionsMe(note.body, handles)).reverse();
}

function ticketLabel(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  return ticket ? `${ticket.client_name}: ${ticket.subject}` : 'un ticket';
}

function openTicketFromNotice(ticketId) {
  if (!state.authorized) return;
  if (ticketId && state.tickets.some((ticket) => ticket.id === ticketId)) void selectTicket(ticketId);
  else navigateTo('tickets');
}

function clip(text, max = 110) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Solo lo que le toca a cada uno: tickets nuevos míos o sin dueño, respuestas en mis tickets,
// tickets que me asignaron y menciones. Varios eventos juntos salen en un único aviso.
function notifyDesktop({ fresh, replies, assignedToMe, mentions, userId }) {
  if (notifyStatus() !== 'on' || isPortalInView()) return;
  const mine = (ticket) => ticket.assigned_agent_id === userId || !ticket.assigned_agent_id;
  const events = [];
  const seen = new Set();
  const push = (event) => {
    const key = `${event.kind}:${event.ticketId}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(event);
  };
  fresh.filter(mine).forEach((ticket) => push({
    kind: 'new', ticketId: ticket.id, title: `Ticket nuevo de ${ticket.client_name}`, line: `Nuevo: ${ticket.client_name}`, body: ticket.subject,
  }));
  assignedToMe.forEach((ticket) => push({
    kind: 'assigned', ticketId: ticket.id, title: 'Te asignaron un ticket', line: `Asignado: ${ticket.client_name}`, body: `${ticket.client_name}: ${ticket.subject}`,
  }));
  replies.filter((ticket) => ticket.assigned_agent_id === userId || (state.role === 'owner' && !ticket.assigned_agent_id)).forEach((ticket) => push({
    kind: 'reply', ticketId: ticket.id, title: `${ticket.client_name} respondió`, line: `Respuesta: ${ticket.client_name}`, body: ticket.subject,
  }));
  mentions.forEach((note) => {
    const author = memberName(teamMember(note.actor_id), 'Alguien del equipo');
    push({ kind: 'mention', ticketId: note.ticket_id, title: `${author} te mencionó`, line: `Mención de ${firstWord(author)}`, body: `${clip(note.body)} · ${ticketLabel(note.ticket_id)}` });
  });
  if (!events.length) return;
  if (events.length === 1) {
    const [event] = events;
    showDesktopNotice({ title: event.title, body: clip(event.body, 160), tag: `uvr-ticket-${event.ticketId}`, onClick: () => openTicketFromNotice(event.ticketId) });
    return;
  }
  const lines = events.slice(0, 3).map((event) => event.line);
  if (events.length > 3) lines.push(`y ${events.length - 3} más`);
  showDesktopNotice({
    title: `${events.length} novedades en soporte`,
    body: lines.join('\n'),
    tag: 'uvr-support',
    onClick: () => {
      state.filter = 'open';
      state.ticketSort = 'urgent';
      navigateTo('tickets');
    },
  });
}

function startLive() {
  const userId = state.session?.user?.id;
  if (state.live || !userId) return;
  state.live = createLiveChannel({
    supabase: state.supabase,
    userId,
    onChange: () => void pollSupport(),
    onPresence: ({ viewers, typing }) => {
      state.viewers = viewers;
      state.typing = typing;
      paintViewers();
    },
    onStatus: (ok) => {
      state.liveOk = ok;
      paintLivePill();
      // Al reconectar pudimos perdernos cambios.
      if (ok) void pollSupport();
    },
  });
}

function stopLive() {
  state.live?.stop();
  state.live = null;
  state.liveOk = false;
  state.viewers = {};
  state.typing = {};
  stopTyping();
}

function paintLivePill() {
  const pill = app.querySelector('.live-pill');
  if (!pill) return;
  pill.classList.toggle('is-live', state.liveOk);
  const label = pill.lastElementChild;
  if (label) label.textContent = state.liveOk ? 'En vivo' : 'Sincronizando';
}

function viewersOf(ticketId) {
  return (state.viewers[ticketId] || []).map((id) => memberName(teamMember(id), 'Alguien del equipo'));
}

function fillViewers(slot, ticketId) {
  const names = viewersOf(ticketId);
  slot.replaceChildren();
  slot.hidden = !names.length;
  if (!names.length) return;
  slot.append(
    element('span', 'live-dot'),
    element('span', '', names.length === 1 ? `${names[0]} está viendo este ticket` : `${names.slice(0, 2).join(' y ')}${names.length > 2 ? ` y ${names.length - 2} más` : ''} están viendo este ticket`)
  );
}

function paintViewers() {
  const slot = app.querySelector('.ticket-viewers');
  if (slot) fillViewers(slot, state.selectedId);
  const typing = app.querySelector('.typing-indicator');
  if (typing) fillTyping(typing, state.selectedId);
}

function typistsOf(ticketId) {
  return Object.entries(state.typing[ticketId] || {}).map(([id, kind]) => ({ id, kind, member: teamMember(id) }));
}

function fillTyping(slot, ticketId) {
  const typists = typistsOf(ticketId);
  slot.replaceChildren();
  slot.hidden = !typists.length;
  slot.classList.toggle('is-reply', typists.some((typist) => typist.kind === 'reply'));
  if (!typists.length) return;
  const faces = element('span', 'typing-faces');
  typists.slice(0, 3).forEach(({ member }) => faces.append(renderAvatar(memberName(member, 'Equipo'), member?.avatar_path, 'xs')));
  const dots = element('span', 'typing-dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.append(element('i'), element('i'), element('i'));
  const names = typists.map(({ member }) => firstWord(memberName(member, 'Alguien del equipo')));
  let text;
  if (typists.length === 1) {
    text = `${names[0]} está escribiendo ${typists[0].kind === 'reply' ? 'una respuesta al cliente' : 'una nota interna'}`;
  } else {
    text = `${names.slice(0, 2).join(' y ')}${names.length > 2 ? ` y ${names.length - 2} más` : ''} están escribiendo`;
  }
  const pill = element('span', 'typing-pill');
  pill.append(faces, element('span', 'typing-text', text), dots);
  slot.append(pill);
}

// "Está escribiendo": se avisa al empezar y se apaga tras unos segundos sin teclear, al enviar o al salir.
let typingTimer = null;
let typingKind = null;
let typingTicket = null;
function markTyping(kind) {
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(stopTyping, TYPING_IDLE_MS);
  if (typingKind === kind && typingTicket === state.selectedId) return;
  typingKind = kind;
  typingTicket = state.selectedId;
  state.live?.setTyping(kind);
}

function stopTyping() {
  window.clearTimeout(typingTimer);
  typingTimer = null;
  if (!typingKind) return;
  typingKind = null;
  typingTicket = null;
  state.live?.setTyping(null);
}

function stopPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = null;
  stopLive();
  state.unseenTickets = 0;
  updateDocumentTitle();
}

function resetTicketView() {
  stopPolling();
  state.ticketSort = 'recent';
  state.ticketLimit = TICKET_PAGE_SIZE;
  state.ticketTotal = 0;
  state.ticketsLoaded = false;
  state.ticketsFailed = false;
  state.loadingMore = false;
  state.drafts = {};
  state.profile = null;
  state.team = {};
  state.avatarUrls = {};
  state.avatarUrlsAt = 0;
  state.clientContexts = {};
  state.profileSaving = false;
  state.mentionsSince = null;
  state.typing = {};
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void pollSupport();
});

async function fetchThread(ticketId) {
  const [messages, activity] = await Promise.all([
    state.supabase
      .from('support_ticket_messages')
      .select('id, author_id, author_role, body, attachments, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .limit(200),
    state.supabase
      .from('support_ticket_activity')
      .select('id, actor_id, kind, body, detail, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .limit(200),
  ]);
  // Si la actividad falla, la conversación con el cliente se muestra igual.
  return { error: messages.error, messages: messages.data || [], activity: activity.error ? [] : activity.data || [] };
}

async function loadMessages(ticketId) {
  if (!state.authorized) return;
  const requestId = ++state.messageRequest;
  const userId = state.session?.user?.id;
  void loadClientContext(ticketId);
  const { messages, activity, error } = await fetchThread(ticketId);
  if (
    state.selectedId !== ticketId
    || requestId !== state.messageRequest
    || userId !== state.session?.user?.id
    || !state.authorized
  ) return;
  if (error) {
    if (state.threadFor !== ticketId) {
      state.threadFor = ticketId;
      state.threadError = ticketId;
    }
    setFeedback(userFacingError(error, 'No pudimos cargar los mensajes. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  state.messages = messages;
  state.activity = activity;
  state.threadFor = ticketId;
  state.threadError = null;
  renderDashboard();
}

async function selectTicket(ticketId) {
  const pageChanged = state.page !== 'tickets';
  state.selectedId = ticketId;
  state.quickMenuOpen = false;
  state.threadView = 'all';
  state.composerMode = 'reply';
  state.error = '';
  state.page = 'tickets';
  syncRoute();
  state.unseenTickets = 0;
  updateDocumentTitle();
  state.messages = [];
  state.activity = [];
  state.threadFor = null;
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

// Las respuestas esperan unos segundos antes de salir para poder deshacerlas, como en el correo.
function queueReply(ticket, body, andNext, attachments = []) {
  if (state.pendingSend) void flushPendingSend();
  const pending = {
    ticketId: ticket.id,
    clientName: ticket.client_name,
    body,
    attachments,
    createdAt: new Date().toISOString(),
    queuedAt: Date.now(),
    timer: 0,
  };
  pending.timer = window.setTimeout(() => { void flushPendingSend(); }, UNDO_SEND_MS);
  state.pendingSend = pending;
  delete state.drafts[ticket.id];
  saveDrafts();
  takeBackAttachments(ticket.id, attachments, false);
  setFeedback();
  showToast(`Respuesta a ${firstWord(ticket.client_name) || 'el cliente'} en camino`, 'Deshacer', undoPendingSend, UNDO_SEND_MS);
  if (andNext && openNextPending(ticket.id)) return;
  renderDashboard();
  app.querySelector('.reply-input')?.focus();
}

// Los adjuntos viajan con la respuesta en espera; al deshacer o si falla, vuelven al compositor.
function takeBackAttachments(ticketId, attachments, restore) {
  if (!attachments?.length) return;
  const current = (state.uploads[ticketId] || []).filter((item) => !attachments.includes(item));
  const next = restore ? [...attachments, ...current] : current;
  if (next.length) state.uploads[ticketId] = next;
  else delete state.uploads[ticketId];
}

function undoPendingSend() {
  const pending = state.pendingSend;
  if (!pending) return;
  window.clearTimeout(pending.timer);
  state.pendingSend = null;
  const current = (state.drafts[pending.ticketId] || '').trim();
  const restored = [pending.body, current].filter(Boolean).join('\n\n');
  if (restored) state.drafts[pending.ticketId] = restored;
  saveDrafts();
  takeBackAttachments(pending.ticketId, pending.attachments, true);
  state.composerMode = 'reply';
  if (state.selectedId === pending.ticketId && state.page === 'tickets') renderDashboard();
  else void selectTicket(pending.ticketId);
  const input = app.querySelector('.reply-input');
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

async function flushPendingSend() {
  const pending = state.pendingSend;
  if (!pending) return;
  window.clearTimeout(pending.timer);
  state.pendingSend = null;
  state.delivering.push(pending);
  const userId = state.session?.user?.id;
  const { error } = await state.supabase.rpc('reply_support_ticket', {
    p_ticket_id: pending.ticketId,
    p_message: pending.body,
    p_attachments: pending.attachments.map(({ path, name, width, height }) => (
      width && height ? { path, name, width, height } : { path, name }
    )),
  });
  if (userId !== state.session?.user?.id) return;
  if (error) {
    state.delivering = state.delivering.filter((item) => item !== pending);
    const current = (state.drafts[pending.ticketId] || '').trim();
    const restored = [pending.body, current].filter(Boolean).join('\n\n');
    if (restored) state.drafts[pending.ticketId] = restored;
    saveDrafts();
    takeBackAttachments(pending.ticketId, pending.attachments, true);
    setFeedback(userFacingError(error, 'No pudimos enviar la respuesta. Quedó como borrador.'));
    showToast(`No se envió la respuesta a ${firstWord(pending.clientName) || 'el cliente'}. Quedó como borrador.`, 'Abrir', () => selectTicket(pending.ticketId));
    if (state.authorized) renderDashboard();
    return;
  }
  pending.attachments.forEach((item) => {
    // La vista previa local evita un parpadeo mientras llega la URL firmada.
    if (item.preview) state.attachUrls[item.path] = { url: item.preview, at: Date.now() };
  });
  await Promise.all([
    loadTickets(),
    loadDashboardStats(),
    state.selectedId === pending.ticketId ? loadMessages(pending.ticketId) : null,
  ]);
  state.delivering = state.delivering.filter((item) => item !== pending);
  if (state.authorized && state.page === 'tickets' && state.selectedId === pending.ticketId && !isTypingInApp()) renderDashboard();
}

function openNextPending(currentId) {
  const ids = [...app.querySelectorAll('.ticket-row')].map((row) => row.dataset.ticketId);
  const index = ids.indexOf(currentId);
  const ordered = index < 0 ? ids : [...ids.slice(index + 1), ...ids.slice(0, index)];
  const next = ordered
    .map((id) => state.tickets.find((ticket) => ticket.id === id))
    .find((ticket) => ticket && ['open', 'in_progress'].includes(ticket.status));
  if (!next) {
    setFeedback('', 'No quedan tickets pendientes en esta vista. ¡Bien ahí!');
    return false;
  }
  void selectTicket(next.id);
  app.querySelector('.reply-input')?.focus();
  return true;
}

window.addEventListener('beforeunload', (event) => {
  if (!state.pendingSend) return;
  void flushPendingSend();
  event.preventDefault();
  event.returnValue = '';
});

async function addNote(ticketId, body) {
  if (!body) return;
  const userId = state.session?.user?.id;
  state.busy = true;
  setFeedback();
  renderDashboard();
  const { error } = await state.supabase.rpc('add_support_ticket_note', {
    p_ticket_id: ticketId,
    p_body: body,
  });
  if (userId !== state.session?.user?.id) return;
  state.busy = false;
  if (error) {
    setFeedback(userFacingError(error, 'No pudimos guardar la nota. Probá de nuevo.'));
    renderDashboard();
    return;
  }
  setFeedback('', 'Nota guardada. Solo la ve el equipo.');
  delete state.noteDrafts[ticketId];
  if (state.threadView === 'chat') state.threadView = 'all';
  await loadMessages(ticketId);
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
  await Promise.all([loadTickets(), loadDashboardStats(), state.selectedId === ticketId ? loadMessages(ticketId) : null]);
}

async function signOut() {
  await flushPendingSend();
  clearSavedDrafts();
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
  state.activity = [];
  state.uploads = {};
  state.attachUrls = {};
  document.querySelector('dialog.viewer')?.remove();
  state.threadFor = null;
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
    state.activity = [];
    state.threadFor = null;
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
  loadDrafts();
  loadNotifyPrefs(state.session?.user?.id);
  if (state.role !== 'owner' && state.page === 'agents') state.page = 'overview';
  syncRoute({ replace: true });
  startPolling();
  startLive();
  const dashboardRequests = [loadDashboardStats(), loadTeam()];
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
      state.activity = [];
      state.threadFor = null;
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
