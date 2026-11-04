const MAX_RESULTS = 40;

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR');
}

function score(item, tokens) {
  const label = normalize(item.label);
  const haystack = `${label} ${normalize(item.keywords)} ${normalize(item.hint)}`;
  let total = 0;
  for (const token of tokens) {
    if (!haystack.includes(token)) return -1;
    total += label.startsWith(token) ? 3 : label.includes(token) ? 2 : 1;
  }
  return total;
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

let overlay = null;

export function isPaletteOpen() {
  return Boolean(overlay);
}

export function closePalette() {
  if (!overlay) return;
  const restore = overlay.restoreFocus;
  overlay.remove();
  overlay = null;
  if (restore?.isConnected) restore.focus({ preventScroll: true });
}

// getItems devuelve [{ id, group, label, hint, keywords, run }]; se evalúa al abrir para ver el estado actual.
export function openPalette(getItems) {
  if (overlay) return;
  const items = getItems();
  const backdrop = node('div', 'palette-backdrop');
  backdrop.restoreFocus = document.activeElement;
  const dialog = node('div', 'palette');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Paleta de comandos');

  const input = node('input', 'palette-input');
  input.type = 'text';
  input.placeholder = 'Buscá un ticket o escribí un comando…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'palette-list');
  input.setAttribute('aria-autocomplete', 'list');

  const list = node('ul', 'palette-list');
  list.id = 'palette-list';
  list.setAttribute('role', 'listbox');
  const footer = node('div', 'palette-footer');
  footer.append(
    node('span', '', '↑↓ moverse'),
    node('span', '', '↵ elegir'),
    node('span', '', 'Esc cerrar')
  );
  dialog.append(input, list, footer);
  backdrop.append(dialog);

  let results = [];
  let active = 0;

  const paint = () => {
    list.replaceChildren();
    if (!results.length) {
      list.append(node('li', 'palette-empty', 'No encontramos nada con eso.'));
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let lastGroup = '';
    results.forEach((item, index) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const heading = node('li', 'palette-group', item.group);
        heading.setAttribute('role', 'presentation');
        list.append(heading);
      }
      const row = node('li', `palette-item${index === active ? ' is-active' : ''}`);
      row.id = `palette-option-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === active ? 'true' : 'false');
      row.append(node('span', 'palette-label', item.label));
      if (item.hint) row.append(node('span', 'palette-hint', item.hint));
      row.addEventListener('mousemove', () => {
        if (active === index) return;
        active = index;
        paint();
      });
      row.addEventListener('click', () => choose(index));
      list.append(row);
    });
    input.setAttribute('aria-activedescendant', `palette-option-${active}`);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };

  const filter = () => {
    const tokens = normalize(input.value).split(/\s+/).filter(Boolean);
    results = tokens.length
      ? items
        .map((item) => ({ item, points: score(item, tokens) }))
        .filter((entry) => entry.points >= 0)
        .sort((a, b) => b.points - a.points)
        .map((entry) => entry.item)
      : items.filter((item) => item.featured);
    results = results.slice(0, MAX_RESULTS);
    active = 0;
    paint();
  };

  const choose = (index) => {
    const item = results[index];
    if (!item) return;
    closePalette();
    item.run();
  };

  input.addEventListener('input', filter);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) closePalette();
  });

  overlay = backdrop;
  document.body.append(backdrop);
  filter();
  input.focus();
}
