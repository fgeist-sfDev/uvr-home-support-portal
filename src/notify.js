// Avisos de escritorio. El permiso se pide solo cuando el agente lo elige, y se avisa
// únicamente si la pestaña no está a la vista: con el portal enfrente alcanzan los avisos internos.
const PREFS_KEY = 'uvr.support.notify';
const ICON_URL = new URL(`${import.meta.env.BASE_URL}favicon.png`, window.location.href).href;
export const SNOOZE_MS = 3600000;

let prefs = { enabled: false, dismissed: false, snoozeUntil: 0 };
let storageKey = '';

export function loadNotifyPrefs(userId) {
  storageKey = userId ? `${PREFS_KEY}.${userId}` : '';
  prefs = { enabled: false, dismissed: false, snoozeUntil: 0 };
  if (!storageKey) return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    prefs = {
      enabled: saved.enabled === true,
      dismissed: saved.dismissed === true,
      snoozeUntil: Number(saved.snoozeUntil) || 0,
    };
  } catch { /* Preferencias ilegibles: se arranca con los avisos apagados. */ }
}

function savePrefs() {
  if (!storageKey) return;
  try { localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch { /* Sin almacenamiento: dura hasta recargar. */ }
}

export function notifySupported() {
  return typeof window.Notification === 'function' && window.isSecureContext;
}

// 'unsupported' | 'denied' | 'off' | 'snoozed' | 'on'
export function notifyStatus() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted' || !prefs.enabled) return 'off';
  if (prefs.snoozeUntil > Date.now()) return 'snoozed';
  return 'on';
}

export function snoozedUntil() {
  return prefs.snoozeUntil;
}

export function shouldOfferNotify() {
  return notifySupported() && Notification.permission !== 'denied' && !prefs.enabled && !prefs.dismissed;
}

export async function enableNotify() {
  let permission = Notification.permission;
  if (permission === 'default') {
    try { permission = await Notification.requestPermission(); } catch { permission = 'denied'; }
  }
  prefs.enabled = permission === 'granted';
  // Si el navegador lo bloqueó, no volvemos a ofrecerlo en el resumen.
  prefs.dismissed = !prefs.enabled;
  prefs.snoozeUntil = 0;
  savePrefs();
  return notifyStatus();
}

export function disableNotify() {
  prefs.enabled = false;
  prefs.dismissed = true;
  prefs.snoozeUntil = 0;
  savePrefs();
}

export function dismissNotifyOffer() {
  prefs.dismissed = true;
  savePrefs();
}

export function snoozeNotify(ms = SNOOZE_MS) {
  prefs.snoozeUntil = Date.now() + ms;
  savePrefs();
}

export function resumeNotify() {
  prefs.snoozeUntil = 0;
  savePrefs();
}

export function isPortalInView() {
  return !document.hidden && document.hasFocus();
}

export function showDesktopNotice({ title, body, tag, onClick, force = false }) {
  if (notifyStatus() !== 'on' || (!force && isPortalInView())) return false;
  try {
    // Con el mismo tag, el aviso nuevo reemplaza al anterior en vez de apilarse.
    const notice = new Notification(title, { body, tag, icon: ICON_URL, badge: ICON_URL, renotify: Boolean(tag) });
    notice.onclick = () => {
      window.focus();
      notice.close();
      onClick?.();
    };
    return true;
  } catch {
    // Chrome en Android solo permite avisos desde un service worker.
    return false;
  }
}
