// Canal privado "support-live": cambios de tickets y mensajes en vivo, y presencia del equipo
// (quién mira cada ticket y si está escribiendo una respuesta o una nota).
// Los cambios llegan filtrados por la RLS de cada tabla; la presencia, por las políticas de realtime.messages.
const CHANGE_DEBOUNCE_MS = 350;

export function createLiveChannel({ supabase, userId, onChange, onPresence, onStatus }) {
  let channel = null;
  let timer = null;
  let ticketId = null;
  // 'reply' | 'note' | null: qué está escribiendo este agente en el ticket abierto.
  let typing = null;
  let subscribed = false;

  const schedule = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      onChange();
    }, CHANGE_DEBOUNCE_MS);
  };

  const presence = () => {
    const byTicket = {};
    const typingByTicket = {};
    const online = [];
    for (const [key, metas] of Object.entries(channel?.presenceState() || {})) {
      if (key === userId) continue;
      if (metas?.length) online.push(key);
      for (const meta of metas) {
        if (typeof meta?.ticket !== 'string') continue;
        (byTicket[meta.ticket] ||= new Set()).add(key);
        if (meta.typing === 'reply' || meta.typing === 'note') (typingByTicket[meta.ticket] ||= {})[key] = meta.typing;
      }
    }
    return {
      viewers: Object.fromEntries(Object.entries(byTicket).map(([id, people]) => [id, [...people]])),
      typing: typingByTicket,
      online,
    };
  };

  const announce = () => {
    if (!channel || !subscribed) return;
    void channel.track(ticketId && typing ? { ticket: ticketId, typing } : { ticket: ticketId }).catch(() => {});
  };

  channel = supabase
    .channel('support-live', { config: { private: true, presence: { key: userId } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, schedule)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_ticket_messages' }, schedule)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_ticket_activity' }, schedule)
    .on('presence', { event: 'sync' }, () => onPresence(presence()))
    .subscribe((status) => {
      subscribed = status === 'SUBSCRIBED';
      onStatus(subscribed);
      if (subscribed) announce();
      else onPresence({ viewers: {}, typing: {}, online: [] });
    });

  return {
    setTicket(next) {
      if (next === ticketId) return;
      ticketId = next;
      typing = null;
      announce();
    },
    setTyping(next) {
      const value = next === 'reply' || next === 'note' ? next : null;
      if (value === typing) return;
      typing = value;
      announce();
    },
    stop() {
      if (timer) window.clearTimeout(timer);
      timer = null;
      subscribed = false;
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    },
  };
}
