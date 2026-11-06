// Selector de íconos (Material Design Icons). La app usa MaterialCommunityIcons de @expo/vector-icons,
// que trae los mismos íconos que @mdi/js 7.4.47: todo lo que se elige acá existe en la app.
// El paquete pesa unos MB: se carga aparte y solo cuando se abre la sección Configuración.

let icons = null;
let loading = null;

// Nombres que no se pueden convertir de forma confiable desde @mdi/js (y no hacen falta en la app).
const AMBIGUOUS = /^(dice-d-|ev-plug-(ccs|type)-|keyboard-f-|language-(css|html)-|molecule-co-|surround-sound-)/;
const LIMIT = 160;

export const SUGGESTED = [
  'broom', 'spray-bottle', 'vacuum', 'washing-machine', 'iron', 'pipe-wrench', 'water-pump', 'faucet',
  'shower-head', 'toilet', 'water-boiler', 'flash', 'lightning-bolt', 'power-plug', 'lightbulb-on-outline', 'fire',
  'gas-burner', 'radiator', 'air-conditioner', 'fan', 'flower', 'sprout', 'grass', 'tree', 'shovel', 'watering-can',
  'format-paint', 'brush', 'palette', 'hand-saw', 'saw-blade', 'hammer', 'hammer-wrench', 'tools', 'screwdriver',
  'wrench', 'key-variant', 'lock', 'door', 'home-roof', 'wall', 'ladder', 'hard-hat', 'fridge', 'stove', 'chef-hat',
  'pot-steam', 'baby-face-outline', 'baby-carriage', 'human-child', 'teddy-bear', 'human-cane', 'wheelchair',
  'hand-heart', 'heart-pulse', 'medical-bag', 'dog', 'cat', 'paw', 'truck', 'dolly', 'package-variant-closed',
  'laptop', 'television', 'wifi', 'cctv', 'car-wrench', 'bug', 'pool', 'solar-panel', 'content-cut', 'needle',
  'school', 'party-popper', 'shield-check', 'information-outline',
];

// Palabras en castellano (sin tildes) que llevan a íconos en inglés.
const KEYWORDS = {
  limpieza: ['broom', 'spray-bottle', 'vacuum', 'bucket', 'washing-machine', 'iron'],
  plomeria: ['pipe-wrench', 'water-pump', 'faucet', 'pipe', 'water', 'shower-head', 'toilet', 'water-boiler'],
  agua: ['water', 'water-pump', 'faucet', 'water-boiler', 'pool', 'watering-can'],
  canilla: ['faucet', 'water-pump'],
  electricidad: ['flash', 'lightning-bolt', 'power-plug', 'power-socket', 'lightbulb', 'lightbulb-on-outline', 'electric-switch'],
  luz: ['lightbulb', 'lightbulb-on-outline', 'lamp', 'ceiling-light', 'flash'],
  enchufe: ['power-plug', 'power-socket'],
  gas: ['fire', 'gas-burner', 'water-boiler', 'radiator', 'gas-cylinder'],
  calefaccion: ['radiator', 'fire', 'water-boiler', 'thermometer'],
  jardin: ['flower', 'sprout', 'grass', 'tree', 'shovel', 'leaf', 'watering-can', 'mower'],
  plantas: ['sprout', 'flower', 'leaf', 'watering-can', 'pot-mix'],
  pintura: ['format-paint', 'brush', 'spray', 'palette'],
  carpinteria: ['hand-saw', 'saw-blade', 'hammer', 'wardrobe', 'table-furniture', 'sofa'],
  mueble: ['wardrobe', 'table-furniture', 'sofa', 'bed', 'chair-rolling'],
  arreglos: ['tools', 'hammer-wrench', 'screwdriver', 'wrench', 'hammer'],
  herramientas: ['tools', 'hammer-wrench', 'screwdriver', 'wrench', 'toolbox'],
  cerrajeria: ['key', 'key-variant', 'lock', 'lock-open-variant', 'door'],
  llave: ['key', 'key-variant', 'wrench', 'pipe-wrench'],
  puerta: ['door', 'door-open', 'gate'],
  ventana: ['window-closed-variant', 'window-open-variant', 'blinds'],
  aire: ['air-conditioner', 'fan', 'snowflake', 'air-filter'],
  heladera: ['fridge', 'fridge-outline'],
  electrodomesticos: ['fridge', 'stove', 'microwave', 'washing-machine', 'dishwasher', 'television'],
  cocina: ['chef-hat', 'pot-steam', 'stove', 'silverware-fork-knife', 'food'],
  comida: ['food', 'silverware-fork-knife', 'pot-steam', 'cake-variant'],
  ninera: ['baby-face-outline', 'baby-carriage', 'human-child', 'teddy-bear', 'human-female-boy'],
  bebe: ['baby-face-outline', 'baby-carriage', 'baby-bottle-outline'],
  chicos: ['human-child', 'teddy-bear', 'human-female-boy'],
  mayores: ['human-cane', 'wheelchair', 'hand-heart', 'heart-pulse', 'pill'],
  cuidado: ['hand-heart', 'human-cane', 'heart-pulse', 'medical-bag'],
  salud: ['medical-bag', 'stethoscope', 'heart-pulse', 'needle', 'pill', 'hospital-box'],
  mascotas: ['dog', 'cat', 'paw', 'dog-side', 'bone'],
  perro: ['dog', 'dog-side', 'paw', 'bone'],
  gato: ['cat', 'paw'],
  mudanza: ['truck', 'dolly', 'package-variant-closed', 'van-utility'],
  flete: ['truck', 'van-utility', 'dolly'],
  tecnologia: ['laptop', 'monitor', 'wifi', 'cellphone', 'television', 'printer'],
  computadora: ['laptop', 'monitor', 'desktop-tower-monitor'],
  auto: ['car', 'car-wrench', 'car-wash', 'motorbike', 'bicycle'],
  techo: ['home-roof', 'ladder', 'hard-hat'],
  albanil: ['wall', 'hard-hat', 'account-hard-hat', 'ladder'],
  construccion: ['hard-hat', 'account-hard-hat', 'wall', 'crane', 'excavator'],
  seguridad: ['shield-check', 'cctv', 'alarm-light', 'camera', 'lock'],
  belleza: ['content-cut', 'hair-dryer', 'lipstick', 'spa', 'face-woman-shimmer'],
  peluqueria: ['content-cut', 'hair-dryer'],
  costura: ['needle', 'tshirt-crew', 'hanger'],
  ropa: ['tshirt-crew', 'hanger', 'iron', 'washing-machine'],
  clases: ['school', 'book-open-variant', 'music', 'palette', 'calculator'],
  eventos: ['party-popper', 'glass-wine', 'cake-variant', 'balloon'],
  fumigacion: ['bug', 'spray', 'rodent', 'spider'],
  plagas: ['bug', 'rodent', 'spider', 'spray'],
  pileta: ['pool', 'water'],
  solar: ['solar-panel', 'white-balance-sunny'],
  guantes: ['hand-back-right', 'hand-wash'],
  barbijo: ['face-mask', 'face-mask-outline'],
  altura: ['stairs', 'ladder', 'elevator'],
  escalera: ['stairs', 'ladder'],
  celiaco: ['barley-off', 'barley'],
  harina: ['barley-off', 'barley', 'bread-slice'],
  alergia: ['allergy', 'peanut-off', 'flower-pollen'],
  fumar: ['smoking-off', 'smoking'],
  animales: ['paw', 'paw-off', 'dog', 'cat'],
  idioma: ['translate', 'account-voice'],
  silencio: ['volume-off', 'volume-mute'],
  mujer: ['face-woman', 'human-female'],
  hombre: ['face-man', 'human-male'],
  informacion: ['information-outline', 'alert-circle-outline', 'help-circle-outline'],
};

function toName(key) {
  return key
    .slice(3)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])(?=[A-Z])/g, '$1-')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();
}

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function loadIcons() {
  if (icons) return Promise.resolve(icons);
  loading ||= import('@mdi/js')
    .then((mod) => {
      const map = new Map();
      for (const [key, path] of Object.entries(mod)) {
        if (!key.startsWith('mdi') || typeof path !== 'string') continue;
        const name = toName(key);
        if (!AMBIGUOUS.test(name)) map.set(name, path);
      }
      icons = map;
      return map;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

export function isKnownIcon(name) {
  return Boolean(icons?.has(name));
}

function svg(path) {
  const ns = 'http://www.w3.org/2000/svg';
  const node = document.createElementNS(ns, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(ns, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'currentColor');
  node.append(shape);
  return node;
}

function paint(holder, fallback) {
  const path = icons?.get(holder.dataset.mdi);
  holder.replaceChildren();
  if (path) holder.append(svg(path));
  else if (icons || fallback) holder.textContent = fallback || '?';
}

// Ícono que se dibuja solo cuando termina de cargar el paquete. `fallback`: texto mientras tanto
// o si el nombre no existe.
export function mdiIcon(name, { size = 22, fallback = '' } = {}) {
  const holder = document.createElement('span');
  holder.className = 'mdi-icon';
  holder.dataset.mdi = name || '';
  holder.style.setProperty('--mdi-size', `${size}px`);
  paint(holder, fallback);
  if (!icons) void loadIcons().then(() => paint(holder, fallback)).catch(() => {});
  return holder;
}

function search(query) {
  const q = normalize(query);
  if (!q) return SUGGESTED.filter((name) => icons.has(name));
  const found = new Set();
  if (q.length >= 2) {
    Object.entries(KEYWORDS).forEach(([word, names]) => {
      if (word.includes(q) || q.includes(word)) names.forEach((name) => icons.has(name) && found.add(name));
    });
  }
  const needle = q.replace(/\s+/g, '-');
  for (const name of icons.keys()) {
    if (found.size >= LIMIT) break;
    if (name.startsWith(needle)) found.add(name);
  }
  for (const name of icons.keys()) {
    if (found.size >= LIMIT) break;
    if (name.includes(needle)) found.add(name);
  }
  return [...found];
}

// Abre el selector. Devuelve el nombre elegido o null si se cancela.
export function pickIcon(current, { title = 'Elegí un ícono' } = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'icon-dialog';
    dialog.setAttribute('aria-label', title);
    const head = document.createElement('div');
    head.className = 'icon-dialog-head';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'secondary-button';
    close.textContent = 'Cancelar';
    head.append(heading, close);

    const searchBox = document.createElement('input');
    searchBox.className = 'text-input';
    searchBox.type = 'search';
    searchBox.placeholder = 'Buscá en castellano o en inglés: llave, agua, perro, broom…';
    searchBox.setAttribute('aria-label', 'Buscar ícono');
    const status = document.createElement('p');
    status.className = 'icon-dialog-status';
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    grid.setAttribute('role', 'listbox');
    dialog.append(head, searchBox, status, grid);

    let picked = null;
    const finish = () => dialog.close();
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(picked);
    });
    close.addEventListener('click', finish);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish();
    });

    function draw() {
      if (!icons) {
        status.textContent = 'Cargando íconos…';
        return;
      }
      const results = search(searchBox.value);
      status.textContent = !searchBox.value.trim()
        ? 'Sugeridos para servicios del hogar. Buscá para ver los más de 7.000 disponibles.'
        : results.length
          ? `${results.length >= LIMIT ? `Primeros ${LIMIT}` : results.length} resultado${results.length === 1 ? '' : 's'}.`
          : 'No encontramos íconos con esa palabra. Probá en inglés (por ejemplo "key" o "water").';
      grid.replaceChildren(
        ...results.map((name) => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = `icon-option${name === current ? ' is-selected' : ''}`;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', String(name === current));
          option.title = name;
          option.append(svg(icons.get(name)));
          const label = document.createElement('span');
          label.textContent = name;
          option.append(label);
          option.addEventListener('click', () => {
            picked = name;
            finish();
          });
          return option;
        })
      );
    }

    let timer = null;
    searchBox.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 120);
    });
    document.body.append(dialog);
    dialog.showModal();
    searchBox.focus();
    draw();
    if (!icons) {
      loadIcons()
        .then(draw)
        .catch(() => {
          status.textContent = 'No pudimos cargar los íconos. Revisá la conexión y probá de nuevo.';
        });
    }
  });
}

// Campo de formulario: vista previa + botón para cambiar. `value()` devuelve el nombre elegido.
export function iconField(initial, { title, onChange } = {}) {
  let current = initial || '';
  const wrap = document.createElement('div');
  wrap.className = 'icon-field';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'icon-trigger';
  const preview = document.createElement('span');
  preview.className = 'icon-trigger-preview';
  const name = document.createElement('span');
  name.className = 'icon-trigger-name';
  const action = document.createElement('span');
  action.className = 'icon-trigger-action';
  action.textContent = 'Cambiar';
  trigger.append(preview, name, action);
  wrap.append(trigger);

  function render() {
    preview.replaceChildren(mdiIcon(current, { size: 22, fallback: '?' }));
    name.textContent = current || 'Sin ícono';
    trigger.setAttribute('aria-label', `Ícono: ${current || 'sin elegir'}. Cambiar`);
  }
  trigger.addEventListener('click', async () => {
    const next = await pickIcon(current, { title });
    if (next && next !== current) {
      current = next;
      render();
      onChange?.(next);
    }
    trigger.focus();
  });
  render();
  return { element: wrap, value: () => current };
}
