// Configuración de la app (solo la persona propietaria con MFA). Las reglas de permisos viven en la base:
// RLS deja escribir solo a public.is_support_owner() y cada cambio queda en private.config_audit.
import './config.css';
import { iconField, loadIcons, mdiIcon } from './iconPicker.js';

const TABS = [
  ['categories', 'Rubros'],
  ['requirements', 'Requisitos'],
  ['features', 'Funciones'],
  ['fees', 'Comisiones'],
  ['themes', 'Temas'],
  ['history', 'Historial'],
];
// Opciones con las que arranca un rubro nuevo (después se editan).
const DEFAULT_MATERIALS = [
  ['mine', 'Los pongo yo', 'Yo pongo los materiales'],
  ['pro', 'Que los traiga', 'Que traiga los materiales'],
  ['any', 'Indistinto', null],
];
const UNITS = [
  ['per_job', 'Por trabajo'],
  ['per_visit', 'Por visita'],
  ['per_hour', 'Por hora'],
];
// Códigos de la columna vieja material_options (aparecen en el historial anterior).
const LEGACY_MATERIALS = [
  ['mine', 'Los pone el cliente'],
  ['pro', 'Los trae el profesional'],
  ['any', 'Indistinto'],
];
const PERIODS = [
  ['week', 'Semanal'],
  ['first_month', 'Primer mes'],
];
const ENTITY_NAMES = {
  service_categories: 'Rubro',
  category_pricing: 'Precios',
  service_skills: 'Tarea',
  category_materials: 'Material',
  work_requirements: 'Requisito',
  feature_flags: 'Función',
  platform_settings: 'Comisiones',
  pro_levels: 'Nivel',
  incentive_challenges: 'Desafío',
  app_themes: 'Tema',
};
const FIELD_NAMES = {
  name: 'Nombre',
  short_name: 'Nombre corto',
  app_icon: 'Ícono',
  tint: 'Color',
  sort_order: 'Orden',
  sort: 'Orden',
  is_active: 'Activo',
  active: 'Activo',
  enabled: 'Prendida',
  requires_additional_review: 'Revisión adicional',
  material_options: 'Materiales',
  price_units: 'Formas de cobro',
  per_job: 'Por trabajo',
  per_visit: 'Por visita',
  per_hour: 'Por hora',
  min_percent: 'Mínimo %',
  label: 'Texto',
  note: 'Nota para el profesional',
  category_ids: 'Rubros',
  description: 'Descripción',
  icon: 'Ícono',
  fee_percent: 'Comisión %',
  welcome_free_jobs: 'Trabajos sin comisión',
  surge_fee_threshold: 'Alta demanda desde',
  surge_fee_discount: 'Descuento en alta demanda',
  jobs_per_client_week: 'Trabajos por cliente por semana',
  min_jobs: 'Trabajos mínimos',
  min_rating: 'Calificación mínima',
  fee_discount: 'Descuento de comisión',
  title: 'Título',
  period: 'Período',
  target_jobs: 'Meta de trabajos',
  reward: 'Bono',
  accent: 'Acento',
  highlight: 'Resaltado',
  banner_title: 'Título del aviso',
  banner_text: 'Texto del aviso',
  effect: 'Animación',
  starts_on: 'Desde',
  ends_on: 'Hasta',
  repeats_yearly: 'Todos los años',
  mode: 'Cuándo se ve',
};

const cfg = {
  tab: 'categories',
  data: null,
  loading: false,
  error: '',
  open: null,
  adding: false,
  history: null,
  historyLoading: false,
  busy: false,
};

function el(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = text;
  return item;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
}

function uniqueId(base, taken) {
  let id = base || 'item';
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}

function money(value) {
  return `$ ${Math.round(Number(value) || 0).toLocaleString('es-AR')}`;
}

function formatWhen(value) {
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function field(labelText, control, hint) {
  const label = el('label', 'cfg-field');
  label.append(el('span', 'cfg-field-label', labelText), control);
  if (hint) label.append(hint instanceof Node ? hint : el('small', 'cfg-hint', hint));
  return label;
}

function input(value, { type = 'text', min, max, step, maxLength, placeholder, name } = {}) {
  const item = el('input', 'text-input');
  item.type = type;
  if (name) item.name = name;
  if (min !== undefined) item.min = String(min);
  if (max !== undefined) item.max = String(max);
  if (step !== undefined) item.step = String(step);
  if (maxLength) item.maxLength = maxLength;
  if (placeholder) item.placeholder = placeholder;
  item.value = value ?? '';
  item.disabled = cfg.busy;
  return item;
}

function checkbox(labelText, checked, name) {
  const label = el('label', 'cfg-check');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = Boolean(checked);
  box.disabled = cfg.busy;
  if (name) box.name = name;
  label.append(box, el('span', '', labelText));
  return { label, box };
}

function toggleSwitch(checked, ariaLabel, onChange) {
  const button = el('button', `cfg-switch${checked ? ' is-on' : ''}`);
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(Boolean(checked)));
  button.setAttribute('aria-label', ariaLabel);
  button.disabled = cfg.busy;
  button.append(el('span', 'cfg-switch-knob'));
  button.addEventListener('click', () => onChange(!checked));
  return button;
}

function button(text, className, onClick, type = 'button') {
  const item = el('button', className, text);
  item.type = type;
  item.disabled = cfg.busy;
  if (onClick) item.addEventListener('click', onClick);
  return item;
}

function chip(text, tone = '') {
  return el('span', `cfg-chip${tone ? ` is-${tone}` : ''}`, text);
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function load(ctx) {
  cfg.loading = true;
  cfg.error = '';
  const db = ctx.supabase;
  const results = await Promise.all([
    db.from('service_categories').select('*').order('sort_order'),
    db.from('category_pricing').select('*'),
    db.from('service_skills').select('*').order('sort_order'),
    db.from('category_materials').select('*').order('sort_order'),
    db.from('work_requirements').select('*').order('sort_order'),
    db.from('feature_flags').select('*').order('sort_order'),
    db.from('platform_settings').select('*').maybeSingle(),
    db.from('pro_levels').select('*').order('sort'),
    db.from('incentive_challenges').select('*').order('sort'),
    db.from('app_themes').select('*').order('sort_order').order('id'),
    db.rpc('active_app_theme'),
  ]);
  cfg.loading = false;
  const failed = results.find((result) => result.error);
  if (failed) {
    cfg.error = ctx.userFacingError(failed.error, 'No pudimos cargar la configuración. Probá de nuevo.');
    ctx.rerender();
    return;
  }
  const [categories, pricing, skills, materials, requirements, flags, settings, levels, challenges, themes, activeTheme] = results.map(
    (result) => result.data
  );
  cfg.data = {
    categories,
    pricing: Object.fromEntries(pricing.map((row) => [row.category_id, row])),
    skills,
    materials,
    requirements,
    flags,
    settings,
    levels,
    challenges,
    themes,
    activeTheme: activeTheme?.[0] ?? null,
  };
  ctx.rerender();
}

async function loadHistory(ctx) {
  cfg.historyLoading = true;
  const { data, error } = await ctx.supabase.rpc('admin_config_history', { p_limit: 200 });
  cfg.historyLoading = false;
  if (error) {
    cfg.history = [];
    ctx.toast(ctx.userFacingError(error, 'No pudimos cargar el historial.'));
  } else {
    cfg.history = data;
  }
  ctx.rerender();
}

// Ejecuta un cambio y recarga. Con RLS, una escritura sin permiso no falla: devuelve 0 filas.
async function save(ctx, run, success) {
  cfg.busy = true;
  ctx.rerender();
  let failure = null;
  try {
    const results = await run();
    for (const result of [].concat(results)) {
      if (result?.error) {
        failure = result.error;
        break;
      }
      if (Array.isArray(result?.data) && result.data.length === 0) {
        failure = { userMessage: 'No se guardó. Volvé a entrar con tu segundo factor y probá de nuevo.' };
        break;
      }
    }
  } catch (error) {
    failure = error;
  }
  cfg.busy = false;
  cfg.history = null;
  if (failure) {
    ctx.toast(ctx.userFacingError(failure, 'No pudimos guardar el cambio. Revisá los datos e intentá de nuevo.'));
    ctx.rerender();
    return false;
  }
  ctx.toast(success);
  await load(ctx);
  return true;
}

function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((box) => box.value);
}

function optionChecks(options, selected, name) {
  const group = el('div', 'cfg-checks');
  options.forEach(([value, text]) => {
    const { label, box } = checkbox(text, selected.includes(value), name);
    box.value = value;
    group.append(label);
  });
  return group;
}

// ---------- Rubros ----------

function renderCategoryForm(ctx, category) {
  const pricing = cfg.data.pricing[category.id] || {};
  const form = el('form', 'cfg-form');
  const name = input(category.name, { maxLength: 60 });
  const shortName = input(category.short_name, { maxLength: 30, placeholder: category.name });
  const appIcon = iconField(category.app_icon, { title: `Ícono de ${category.short_name || category.name}` });
  const order = input(category.sort_order, { type: 'number', step: 1 });
  const active = checkbox('Visible en la app', category.is_active);
  const review = checkbox('Requiere revisión adicional del profesional', category.requires_additional_review);

  const basics = el('div', 'cfg-grid');
  basics.append(
    field('Nombre', name),
    field('Nombre corto (en la app)', shortName),
    field('Ícono', appIcon.element),
    field('Orden', order)
  );
  const flags = el('div', 'cfg-checks');
  flags.append(active.label, review.label);

  const units = optionChecks(UNITS, category.price_units || [], 'units');
  const prices = el('div', 'cfg-grid');
  const perJob = input(pricing.per_job, { type: 'number', min: 500, step: 500 });
  const perVisit = input(pricing.per_visit, { type: 'number', min: 500, step: 500 });
  const perHour = input(pricing.per_hour, { type: 'number', min: 500, step: 500 });
  const minPercent = input(pricing.min_percent ?? 70, { type: 'number', min: 10, max: 100, step: 5 });
  prices.append(
    field('Por trabajo', perJob),
    field('Por visita', perVisit),
    field('Por hora', perHour),
    field('Mínimo (% del sugerido)', minPercent, 'El cliente no puede ofrecer menos que esto.')
  );

  form.append(
    el('h4', 'cfg-subtitle', 'Datos'),
    basics,
    flags,
    el('h4', 'cfg-subtitle', 'Formas de cobro'),
    units,
    el('h4', 'cfg-subtitle', 'Precios de referencia'),
    prices
  );
  const actions = el('div', 'cfg-actions');
  actions.append(
    button('Cancelar', 'secondary-button', () => {
      cfg.open = null;
      ctx.rerender();
    }),
    button('Guardar rubro', 'primary-button', null, 'submit')
  );
  form.append(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const priceUnits = checkedValues(form, 'units');
    if (!name.value.trim()) return ctx.toast('Completá el nombre del rubro.');
    if (!priceUnits.length) return ctx.toast('Elegí al menos una forma de cobro.');
    const priceRow = {
      per_job: numberOrNull(perJob.value),
      per_visit: numberOrNull(perVisit.value),
      per_hour: numberOrNull(perHour.value),
      min_percent: numberOrNull(minPercent.value),
    };
    if (Object.values(priceRow).some((value) => !value || value <= 0)) return ctx.toast('Completá todos los precios y el mínimo.');
    if (priceRow.min_percent < 10 || priceRow.min_percent > 100) return ctx.toast('El mínimo tiene que estar entre 10 % y 100 %.');
    void save(ctx, () => Promise.all([
      ctx.supabase
        .from('service_categories')
        .update({
          name: name.value.trim(),
          short_name: shortName.value.trim() || null,
          app_icon: appIcon.value() || null,
          sort_order: numberOrNull(order.value) ?? 0,
          is_active: active.box.checked,
          requires_additional_review: review.box.checked,
          price_units: priceUnits,
        })
        .eq('id', category.id)
        .select('id'),
      cfg.data.pricing[category.id]
        ? ctx.supabase.from('category_pricing').update(priceRow).eq('category_id', category.id).select('category_id')
        : ctx.supabase.from('category_pricing').insert({ category_id: category.id, ...priceRow }).select('category_id'),
    ]), `Guardamos ${name.value.trim()}.`);
  });
  return form;
}

function renderSkills(ctx, category) {
  const wrap = el('div', 'cfg-skills');
  const skills = cfg.data.skills.filter((skill) => skill.category_id === category.id);
  const heading = el('div', 'cfg-row-head');
  heading.append(el('h4', 'cfg-subtitle', `Tareas (${skills.filter((skill) => skill.is_active).length} activas)`));
  wrap.append(heading);
  const list = el('div', 'cfg-table');
  skills.forEach((skill) => {
    const row = el('form', `cfg-table-row${skill.is_active ? '' : ' is-off'}`);
    const name = input(skill.name, { maxLength: 80 });
    name.setAttribute('aria-label', 'Nombre de la tarea');
    const order = input(skill.sort_order, { type: 'number', step: 10 });
    order.classList.add('cfg-narrow');
    order.setAttribute('aria-label', 'Orden');
    const save$ = button('Guardar', 'secondary-button', null, 'submit');
    row.append(
      name,
      order,
      toggleSwitch(skill.is_active, `${skill.is_active ? 'Desactivar' : 'Activar'} ${skill.name}`, (next) =>
        void save(ctx, () => ctx.supabase.from('service_skills').update({ is_active: next }).eq('id', skill.id).select('id'),
          next ? `${skill.name} vuelve a aparecer.` : `${skill.name} ya no aparece en la app.`)
      ),
      save$
    );
    row.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!name.value.trim()) return ctx.toast('Completá el nombre de la tarea.');
      void save(ctx, () => ctx.supabase
        .from('service_skills')
        .update({ name: name.value.trim(), sort_order: numberOrNull(order.value) ?? 0 })
        .eq('id', skill.id)
        .select('id'), 'Tarea guardada.');
    });
    list.append(row);
  });
  wrap.append(list);

  const add = el('form', 'cfg-add');
  const newName = input('', { maxLength: 80, placeholder: 'Nueva tarea, por ejemplo "Limpieza de vidrios"' });
  newName.setAttribute('aria-label', 'Nueva tarea');
  add.append(newName, button('Agregar tarea', 'primary-button', null, 'submit'));
  add.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = newName.value.trim();
    if (text.length < 2) return ctx.toast('Escribí el nombre de la tarea.');
    const taken = new Set(cfg.data.skills.map((skill) => skill.id));
    const nextOrder = Math.max(0, ...skills.map((skill) => skill.sort_order || 0)) + 10;
    void save(ctx, () => ctx.supabase
      .from('service_skills')
      .insert({ id: uniqueId(`${category.id}_${slugify(text)}`, taken), category_id: category.id, name: text, sort_order: nextOrder })
      .select('id'), `Agregamos "${text}".`);
  });
  wrap.append(add);
  return wrap;
}

function renderMaterials(ctx, category) {
  const wrap = el('div', 'cfg-skills');
  const options = cfg.data.materials.filter((item) => item.category_id === category.id);
  const activeCount = options.filter((item) => item.is_active).length;
  wrap.append(el('h4', 'cfg-subtitle', `Materiales (${activeCount} ${activeCount === 1 ? 'opción' : 'opciones'})`));
  wrap.append(el('p', 'cfg-hint', activeCount === 1
    ? 'Con una sola opción el cliente no elige: la ve como información.'
    : activeCount === 0
      ? 'Sin opciones, la app no pregunta por materiales.'
      : 'El cliente elige una. La nota es lo que le llega al profesional (vacía: no se agrega nada).'));
  const list = el('div', 'cfg-table');
  if (options.length) {
    const head = el('div', 'cfg-table-head cfg-material-row');
    head.append(el('span', '', 'Lo que ve el cliente'), el('span', '', 'Nota para el profesional'), el('span', '', 'Orden'), el('span'), el('span'));
    list.append(head);
  }
  options.forEach((option) => {
    const row = el('form', `cfg-table-row cfg-material-row${option.is_active ? '' : ' is-off'}`);
    const label = input(option.label, { maxLength: 30 });
    label.setAttribute('aria-label', 'Lo que ve el cliente');
    const note = input(option.note, { maxLength: 120, placeholder: 'Sin nota' });
    note.setAttribute('aria-label', 'Nota para el profesional');
    const order = input(option.sort_order, { type: 'number', step: 10 });
    order.setAttribute('aria-label', 'Orden');
    row.append(
      label,
      note,
      order,
      toggleSwitch(option.is_active, `${option.is_active ? 'Desactivar' : 'Activar'} ${option.label}`, (next) =>
        void save(ctx, () => ctx.supabase.from('category_materials').update({ is_active: next }).eq('id', option.id).select('id'),
          next ? `"${option.label}" vuelve a aparecer.` : `"${option.label}" ya no aparece en la app.`)
      ),
      button('Guardar', 'secondary-button', null, 'submit')
    );
    row.addEventListener('submit', (event) => {
      event.preventDefault();
      if (label.value.trim().length < 2) return ctx.toast('Completá el texto que ve el cliente.');
      void save(ctx, () => ctx.supabase
        .from('category_materials')
        .update({ label: label.value.trim(), note: note.value.trim() || null, sort_order: numberOrNull(order.value) ?? 0 })
        .eq('id', option.id)
        .select('id'), 'Opción de materiales guardada.');
    });
    list.append(row);
  });
  wrap.append(list);

  const add = el('form', 'cfg-add cfg-add-material');
  const newLabel = input('', { maxLength: 30, placeholder: 'Nueva opción' });
  newLabel.setAttribute('aria-label', 'Nueva opción de materiales');
  const newNote = input('', { maxLength: 120, placeholder: 'Nota (opcional)' });
  newNote.setAttribute('aria-label', 'Nota para el profesional');
  add.append(newLabel, newNote, button('Agregar', 'primary-button', null, 'submit'));
  add.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = newLabel.value.trim();
    if (text.length < 2) return ctx.toast('Escribí el texto de la opción.');
    const taken = new Set(cfg.data.materials.map((item) => item.id));
    const nextOrder = Math.max(0, ...options.map((item) => item.sort_order || 0)) + 10;
    void save(ctx, () => ctx.supabase
      .from('category_materials')
      .insert({
        id: uniqueId(`${category.id}_${slugify(text)}`, taken),
        category_id: category.id,
        label: text,
        note: newNote.value.trim() || null,
        sort_order: nextOrder,
        is_active: true,
      })
      .select('id'), `Agregamos "${text}".`);
  });
  wrap.append(add);
  return wrap;
}

function categorySummary(category) {
  const pricing = cfg.data.pricing[category.id];
  const skills = cfg.data.skills.filter((skill) => skill.category_id === category.id && skill.is_active).length;
  const materials = cfg.data.materials
    .filter((item) => item.category_id === category.id && item.is_active)
    .map((item) => item.label)
    .join(' · ') || 'no pregunta';
  const units = (category.price_units || []).map((id) => UNITS.find(([value]) => value === id)?.[1]).join(' · ');
  const parts = [`${skills} ${skills === 1 ? 'tarea' : 'tareas'}`, units];
  if (pricing) parts.push(`desde ${money(pricing.per_job)} · mínimo ${pricing.min_percent} %`);
  return { line: parts.join(' · '), materials };
}

function renderCategories(ctx, panel) {
  const toolbar = el('div', 'cfg-toolbar');
  toolbar.append(el('p', 'muted', 'Lo que ves acá es lo que ve la app. Los rubros ocultos no aparecen para pedir ni para ofrecer.'));
  if (!cfg.adding) {
    toolbar.append(button('Agregar rubro', 'primary-button', () => {
      cfg.adding = true;
      ctx.rerender();
    }));
  }
  panel.append(toolbar);

  if (cfg.adding) {
    const form = el('form', 'cfg-card cfg-add-card');
    const name = input('', { maxLength: 60, placeholder: 'Por ejemplo "Cerrajería"' });
    form.append(field('Nombre del rubro nuevo', name, 'Se crea oculto: completalo y después hacelo visible.'));
    const actions = el('div', 'cfg-actions');
    actions.append(
      button('Cancelar', 'secondary-button', () => {
        cfg.adding = false;
        ctx.rerender();
      }),
      button('Crear rubro', 'primary-button', null, 'submit')
    );
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = name.value.trim();
      if (text.length < 2) return ctx.toast('Escribí el nombre del rubro.');
      const id = uniqueId(slugify(text), new Set(cfg.data.categories.map((category) => category.id)));
      const order = Math.max(0, ...cfg.data.categories.map((category) => category.sort_order || 0)) + 10;
      const created = await save(ctx, async () => {
        const inserted = await ctx.supabase
          .from('service_categories')
          .insert({ id, name: text, short_name: text.slice(0, 30), app_icon: 'tools', sort_order: order, is_active: false })
          .select('id');
        if (inserted.error) return inserted;
        const materials = await ctx.supabase
          .from('category_materials')
          .insert(DEFAULT_MATERIALS.map(([code, label, note], index) => ({
            id: `${id}_${code}`,
            category_id: id,
            label,
            note,
            sort_order: (index + 1) * 10,
          })))
          .select('id');
        if (materials.error) return materials;
        return ctx.supabase
          .from('category_pricing')
          .insert({ category_id: id, per_job: 25000, per_visit: 12000, per_hour: 10000 })
          .select('category_id');
      }, `Creamos ${text}. Completá los datos y hacelo visible.`);
      if (created) {
        cfg.adding = false;
        cfg.open = id;
        ctx.rerender();
      }
    });
    panel.append(form);
  }

  const list = el('div', 'cfg-list');
  cfg.data.categories.forEach((category) => {
    const open = cfg.open === category.id;
    const card = el('article', `cfg-card${category.is_active ? '' : ' is-off'}${open ? ' is-open' : ''}`);
    const head = el('div', 'cfg-card-head');
    const swatch = el('span', 'cfg-swatch');
    swatch.append(mdiIcon(category.app_icon || 'tools', { size: 22, fallback: (category.short_name || category.name).slice(0, 1) }));
    const copy = el('div', 'cfg-card-copy');
    const title = el('div', 'cfg-card-title');
    title.append(el('strong', '', category.short_name || category.name));
    if (category.short_name && category.short_name !== category.name) title.append(el('span', 'muted', category.name));
    title.append(chip(category.is_active ? 'Visible' : 'Oculto', category.is_active ? 'ok' : 'off'));
    const summary = categorySummary(category);
    copy.append(title, el('span', 'cfg-card-meta', summary.line), el('span', 'cfg-card-meta', `Materiales: ${summary.materials}`));
    const actions = el('div', 'cfg-card-actions');
    actions.append(
      toggleSwitch(category.is_active, `${category.is_active ? 'Ocultar' : 'Mostrar'} ${category.name}`, (next) =>
        void save(ctx, () => ctx.supabase.from('service_categories').update({ is_active: next }).eq('id', category.id).select('id'),
          next ? `${category.name} ya aparece en la app.` : `${category.name} quedó oculto.`)
      ),
      button(open ? 'Cerrar' : 'Editar', 'secondary-button', () => {
        cfg.open = open ? null : category.id;
        ctx.rerender();
      })
    );
    head.append(swatch, copy, actions);
    card.append(head);
    if (open) {
      const body = el('div', 'cfg-card-body');
      const side = el('div', 'cfg-side');
      side.append(renderSkills(ctx, category), renderMaterials(ctx, category));
      body.append(renderCategoryForm(ctx, category), side);
      card.append(body);
    }
    list.append(card);
  });
  panel.append(list);
}

// ---------- Requisitos ----------

function renderRequirements(ctx, panel) {
  panel.append(el('p', 'muted cfg-intro', 'Los profesionales eligen sus requisitos para trabajar y el cliente los ve antes de que lleguen. Nunca se pide ni se muestra el motivo (por ejemplo, una condición de salud). Marcá los rubros donde tiene sentido cada uno: el profesional solo ve los de sus rubros.'));
  const list = el('div', 'cfg-table');
  cfg.data.requirements.forEach((item) => {
    const row = el('form', `cfg-table-row cfg-req-row${item.is_active ? '' : ' is-off'}`);
    const label = input(item.label, { maxLength: 60 });
    label.setAttribute('aria-label', 'Texto que ve el cliente');
    const description = input(item.description, { maxLength: 200, placeholder: 'Descripción (opcional)' });
    description.setAttribute('aria-label', 'Descripción');
    const iconName = iconField(item.icon, { title: `Ícono de "${item.label}"` });
    const selected = item.category_ids || [];
    const cats = el('div', 'cfg-req-cats');
    cats.append(el('span', 'cfg-field-label', 'Rubros'));
    cfg.data.categories.forEach((category) => {
      const { label: check, box } = checkbox(category.short_name || category.name, selected.includes(category.id), 'req-cats');
      box.value = category.id;
      check.classList.add('cfg-cat-check');
      cats.append(check);
    });
    cats.append(el('small', 'cfg-hint', selected.length ? '' : 'Sin marcar: se ofrece en todos los rubros.'));
    row.append(
      label,
      description,
      iconName.element,
      toggleSwitch(item.is_active, `${item.is_active ? 'Desactivar' : 'Activar'} ${item.label}`, (next) =>
        void save(ctx, () => ctx.supabase.from('work_requirements').update({ is_active: next }).eq('id', item.id).select('id'),
          next ? `${item.label} vuelve a estar disponible.` : `${item.label} ya no se puede elegir.`)
      ),
      button('Guardar', 'secondary-button', null, 'submit'),
      cats
    );
    row.addEventListener('submit', (event) => {
      event.preventDefault();
      if (label.value.trim().length < 2) return ctx.toast('Completá el texto del requisito.');
      if (!iconName.value()) return ctx.toast('Elegí un ícono.');
      void save(ctx, () => ctx.supabase
        .from('work_requirements')
        .update({
          label: label.value.trim(),
          description: description.value.trim() || null,
          icon: iconName.value(),
          category_ids: checkedValues(row, 'req-cats'),
        })
        .eq('id', item.id)
        .select('id'), 'Requisito guardado.');
    });
    list.append(row);
  });
  panel.append(list);

  const add = el('form', 'cfg-add');
  const text = input('', { maxLength: 60, placeholder: 'Nuevo requisito, por ejemplo "Trabaja con barbijo"' });
  text.setAttribute('aria-label', 'Nuevo requisito');
  add.append(text, button('Agregar requisito', 'primary-button', null, 'submit'));
  add.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = text.value.trim();
    if (value.length < 2) return ctx.toast('Escribí el requisito.');
    const id = uniqueId(slugify(value), new Set(cfg.data.requirements.map((item) => item.id)));
    const order = Math.max(0, ...cfg.data.requirements.map((item) => item.sort_order || 0)) + 10;
    void save(ctx, () => ctx.supabase.from('work_requirements').insert({ id, label: value, sort_order: order }).select('id'), `Agregamos "${value}".`);
  });
  panel.append(add);
}

// ---------- Funciones ----------

function renderFeatures(ctx, panel) {
  panel.append(el('p', 'muted cfg-intro', 'Prendé o apagá funciones sin publicar una versión nueva. La app toma el cambio en unos minutos.'));
  const list = el('div', 'cfg-list');
  cfg.data.flags.forEach((flag) => {
    const card = el('article', 'cfg-card cfg-flag');
    const copy = el('div', 'cfg-card-copy');
    const title = el('div', 'cfg-card-title');
    title.append(el('strong', '', flag.label), chip(flag.enabled ? 'Prendida' : 'Apagada', flag.enabled ? 'ok' : 'off'));
    copy.append(title, el('span', 'cfg-card-meta', flag.description || ''));
    card.append(
      copy,
      toggleSwitch(flag.enabled, `${flag.enabled ? 'Apagar' : 'Prender'} ${flag.label}`, (next) =>
        void save(ctx, () => ctx.supabase.from('feature_flags').update({ enabled: next }).eq('key', flag.key).select('key'),
          `${flag.label}: ${next ? 'prendida' : 'apagada'}.`)
      )
    );
    list.append(card);
  });
  panel.append(list);
}

// ---------- Comisiones ----------

function renderFees(ctx, panel) {
  const settings = cfg.data.settings;
  if (settings) {
    const form = el('form', 'cfg-card cfg-form');
    form.append(el('h3', 'cfg-section-title', 'Comisión de la plataforma'));
    const fee = input(settings.fee_percent, { type: 'number', min: 0, max: 50, step: 0.5 });
    const welcome = input(settings.welcome_free_jobs, { type: 'number', min: 0, max: 100, step: 1 });
    const threshold = input(settings.surge_fee_threshold, { type: 'number', min: 1, max: 2, step: 0.1 });
    const discount = input(Math.round(Number(settings.surge_fee_discount) * 100), { type: 'number', min: 0, max: 100, step: 5 });
    const perClient = input(settings.jobs_per_client_week, { type: 'number', min: 1, step: 1 });
    const grid = el('div', 'cfg-grid');
    grid.append(
      field('Comisión (%)', fee),
      field('Primeros trabajos sin comisión', welcome),
      field('Alta demanda desde (x)', threshold, 'Multiplicador de tarifa dinámica.'),
      field('Descuento de comisión en alta demanda (%)', discount),
      field('Trabajos por cliente por semana que cuentan', perClient, 'Para niveles y desafíos.')
    );
    const actions = el('div', 'cfg-actions');
    actions.append(button('Guardar comisiones', 'primary-button', null, 'submit'));
    form.append(grid, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void save(ctx, () => ctx.supabase
        .from('platform_settings')
        .update({
          fee_percent: numberOrNull(fee.value),
          welcome_free_jobs: numberOrNull(welcome.value),
          surge_fee_threshold: numberOrNull(threshold.value),
          surge_fee_discount: (numberOrNull(discount.value) ?? 0) / 100,
          jobs_per_client_week: numberOrNull(perClient.value),
        })
        .eq('id', true)
        .select('id'), 'Comisiones guardadas.');
    });
    panel.append(form);
  }

  const levels = el('section', 'cfg-card');
  levels.append(el('h3', 'cfg-section-title', 'Niveles de profesionales'), el('p', 'muted', 'Con más trabajos en los últimos 30 días y buena calificación, pagan menos comisión.'));
  const levelTable = el('div', 'cfg-table');
  const levelHead = el('div', 'cfg-table-head cfg-level-row');
  ['Nivel', 'Trabajos', 'Calificación', 'Descuento %', ''].forEach((text) => levelHead.append(el('span', '', text)));
  levelTable.append(levelHead);
  cfg.data.levels.forEach((level) => {
    const row = el('form', 'cfg-table-row cfg-level-row');
    const name = input(level.name, { maxLength: 40 });
    const minJobs = input(level.min_jobs, { type: 'number', min: 0, step: 1 });
    const minRating = input(level.min_rating, { type: 'number', min: 0, max: 5, step: 0.1 });
    const discount = input(Math.round(Number(level.fee_discount) * 100), { type: 'number', min: 0, max: 100, step: 5 });
    name.setAttribute('aria-label', 'Nombre del nivel');
    minJobs.setAttribute('aria-label', 'Trabajos mínimos');
    minRating.setAttribute('aria-label', 'Calificación mínima');
    discount.setAttribute('aria-label', 'Descuento de comisión');
    row.append(name, minJobs, minRating, discount, button('Guardar', 'secondary-button', null, 'submit'));
    row.addEventListener('submit', (event) => {
      event.preventDefault();
      void save(ctx, () => ctx.supabase
        .from('pro_levels')
        .update({
          name: name.value.trim(),
          min_jobs: numberOrNull(minJobs.value),
          min_rating: numberOrNull(minRating.value),
          fee_discount: (numberOrNull(discount.value) ?? 0) / 100,
        })
        .eq('id', level.id)
        .select('id'), `Nivel ${name.value.trim()} guardado.`);
    });
    levelTable.append(row);
  });
  levels.append(levelTable);
  panel.append(levels);

  const challenges = el('section', 'cfg-card');
  challenges.append(el('h3', 'cfg-section-title', 'Desafíos'), el('p', 'muted', 'Completar una meta de trabajos suma un bono que paga las próximas comisiones.'));
  const challengeTable = el('div', 'cfg-table');
  const challengeHead = el('div', 'cfg-table-head cfg-challenge-row');
  ['Título', 'Período', 'Meta', 'Bono ($)', 'Activo', ''].forEach((text) => challengeHead.append(el('span', '', text)));
  challengeTable.append(challengeHead);
  cfg.data.challenges.forEach((challenge) => {
    const row = el('form', `cfg-table-row cfg-challenge-row${challenge.active ? '' : ' is-off'}`);
    const title = input(challenge.title, { maxLength: 60 });
    const period = el('select', 'text-input');
    PERIODS.forEach(([value, text]) => {
      const option = el('option', '', text);
      option.value = value;
      option.selected = challenge.period === value;
      period.append(option);
    });
    period.disabled = cfg.busy;
    const target = input(challenge.target_jobs, { type: 'number', min: 1, step: 1 });
    const reward = input(challenge.reward, { type: 'number', min: 500, step: 500 });
    title.setAttribute('aria-label', 'Título del desafío');
    period.setAttribute('aria-label', 'Período');
    target.setAttribute('aria-label', 'Meta de trabajos');
    reward.setAttribute('aria-label', 'Bono');
    row.append(
      title,
      period,
      target,
      reward,
      toggleSwitch(challenge.active, `${challenge.active ? 'Pausar' : 'Activar'} ${challenge.title}`, (next) =>
        void save(ctx, () => ctx.supabase.from('incentive_challenges').update({ active: next }).eq('id', challenge.id).select('id'),
          `${challenge.title}: ${next ? 'activo' : 'pausado'}.`)
      ),
      button('Guardar', 'secondary-button', null, 'submit')
    );
    row.addEventListener('submit', (event) => {
      event.preventDefault();
      void save(ctx, () => ctx.supabase
        .from('incentive_challenges')
        .update({ title: title.value.trim(), period: period.value, target_jobs: numberOrNull(target.value), reward: numberOrNull(reward.value) })
        .eq('id', challenge.id)
        .select('id'), 'Desafío guardado.');
    });
    challengeTable.append(row);
  });
  challenges.append(challengeTable);
  const add = el('form', 'cfg-add');
  const newTitle = input('', { maxLength: 60, placeholder: 'Nuevo desafío, por ejemplo "Fin de semana"' });
  newTitle.setAttribute('aria-label', 'Nuevo desafío');
  add.append(newTitle, button('Agregar desafío', 'primary-button', null, 'submit'));
  add.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = newTitle.value.trim();
    if (value.length < 2) return ctx.toast('Escribí el título del desafío.');
    const id = uniqueId(slugify(value), new Set(cfg.data.challenges.map((item) => item.id)));
    const order = Math.max(0, ...cfg.data.challenges.map((item) => item.sort || 0)) + 1;
    void save(ctx, () => ctx.supabase
      .from('incentive_challenges')
      .insert({ id, title: value, period: 'week', target_jobs: 10, reward: 5000, active: false, sort: order })
      .select('id'), `Agregamos "${value}" en pausa. Ajustalo y activalo.`);
  });
  challenges.append(add);
  panel.append(challenges);
}

// ---------- Temas ----------

const EFFECTS = [
  ['none', 'Sin animación'],
  ['snow', 'Nieve'],
  ['confetti', 'Papelitos'],
  ['hearts', 'Corazones'],
  ['flowers', 'Flores'],
  ['stars', 'Estrellas'],
  ['leaves', 'Hojas'],
  ['balloons', 'Globos'],
];
const MODES = [
  ['auto', 'Automático'],
  ['on', 'Prendido'],
  ['off', 'Apagado'],
];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Colores de siempre de la app (los mismos que usa cuando no hay tema).
const APP_ACCENT = '#0F3D2E';
const APP_HIGHLIGHT = '#CBF36B';
const DARK_INK = '#0D1F18';

function hexRgb(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex) {
  const rgb = hexRgb(hex) || [0, 0, 0];
  const [r, g, b] = rgb.map((part) => {
    const c = part / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Igual que en la app: texto blanco u oscuro, el que se lea mejor.
function inkOn(background) {
  return contrast(background, '#FFFFFF') >= contrast(background, DARK_INK) ? '#FFFFFF' : DARK_INK;
}

function softOf(hex) {
  const rgb = hexRgb(hex);
  if (!rgb) return '#E3EEE6';
  return `#${rgb.map((part) => Math.round(part + (255 - part) * 0.86).toString(16).padStart(2, '0')).join('')}`;
}

// Igual que en la app: para textos sobre blanco, un acento muy claro se oscurece hasta leerse.
function textOnLight(hex) {
  const rgb = hexRgb(hex);
  if (!rgb || contrast(hex, '#FFFFFF') >= 3) return hex;
  const dark = hexRgb(DARK_INK);
  for (let amount = 0.1; amount < 1; amount += 0.1) {
    const mixed = `#${rgb.map((part, index) => Math.round(part + (dark[index] - part) * amount).toString(16).padStart(2, '0')).join('')}`;
    if (contrast(mixed, '#FFFFFF') >= 3) return mixed;
  }
  return DARK_INK;
}

function argentinaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

// Misma regla que public.active_app_theme: los anuales comparan día y mes y pueden cruzar el año.
function themeInRange(theme, today) {
  if (!theme.starts_on || !theme.ends_on) return false;
  if (!theme.repeats_yearly) return theme.starts_on <= today && today <= theme.ends_on;
  const [start, end, day] = [theme.starts_on.slice(5), theme.ends_on.slice(5), today.slice(5)];
  return start <= end ? start <= day && day <= end : day >= start || day <= end;
}

function shortDate(value, withYear) {
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;
}

function themeDates(theme) {
  if (!theme.starts_on || !theme.ends_on) return 'Sin fecha';
  const yearly = theme.repeats_yearly;
  return `${shortDate(theme.starts_on, !yearly)} al ${shortDate(theme.ends_on, !yearly)}${yearly ? ' · todos los años' : ''}`;
}

function themeStatus(theme) {
  const current = cfg.data.activeTheme;
  if (current?.id === theme.id) return ['Se ve ahora', 'ok'];
  if (theme.mode === 'off') return ['Apagado', 'off'];
  if (theme.mode === 'on') return current ? [`Prendido, pero se ve "${current.name}"`, ''] : ['Prendido', ''];
  if (!theme.starts_on) return ['Sin fecha: no se va a ver', 'off'];
  if (themeInRange(theme, argentinaToday())) return current ? [`En fecha, pero se ve "${current.name}"`, ''] : ['En fecha', ''];
  return ['Programado', ''];
}

function themeSwatch(theme, size = 22) {
  const swatch = el('span', 'cfg-swatch cfg-theme-swatch');
  const accent = hexRgb(theme.accent) ? theme.accent : APP_ACCENT;
  swatch.style.background = accent;
  swatch.style.color = inkOn(accent);
  swatch.append(mdiIcon(theme.icon || 'party-popper', { size, fallback: (theme.name || '?').slice(0, 1) }));
  return swatch;
}

function setThemeMode(ctx, theme, mode) {
  // Solo uno puede estar forzado: los otros prendidos vuelven a automático.
  const others = mode === 'on' ? cfg.data.themes.filter((item) => item.id !== theme.id && item.mode === 'on') : [];
  const extra = others.length ? ` ${others.map((item) => item.name).join(', ')} volvió a automático.` : '';
  const message =
    mode === 'on'
      ? `${theme.name} se va a ver en la app en unos minutos.${extra}`
      : mode === 'auto'
        ? `${theme.name} se va a ver solo en sus fechas.`
        : `${theme.name} quedó apagado.`;
  void save(ctx, () => Promise.all([
    ctx.supabase.from('app_themes').update({ mode }).eq('id', theme.id).select('id'),
    ...others.map((item) => ctx.supabase.from('app_themes').update({ mode: 'auto' }).eq('id', item.id).select('id')),
  ]), message);
}

function modeControl(ctx, theme) {
  const group = el('div', 'cfg-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', `Cuándo se ve ${theme.name}`);
  MODES.forEach(([value, text]) => {
    const selected = theme.mode === value;
    const option = button(text, `cfg-seg-option${selected ? ' is-active' : ''}`, () => {
      if (!selected) setThemeMode(ctx, theme, value);
    });
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(selected));
    group.append(option);
  });
  return group;
}

function colorField(value, ariaLabel) {
  const wrap = el('div', 'cfg-color');
  const picker = el('input', 'cfg-color-picker');
  picker.type = 'color';
  picker.value = (hexRgb(value) ? value : APP_ACCENT).toLowerCase();
  picker.disabled = cfg.busy;
  picker.setAttribute('aria-label', ariaLabel);
  const text = input((hexRgb(value) ? value : APP_ACCENT).toUpperCase(), { maxLength: 7 });
  text.setAttribute('aria-label', `${ariaLabel} (código)`);
  text.spellcheck = false;
  picker.addEventListener('input', () => {
    text.value = picker.value.toUpperCase();
    wrap.dispatchEvent(new Event('change', { bubbles: true }));
  });
  text.addEventListener('input', () => {
    const typed = text.value.trim().startsWith('#') ? text.value.trim() : `#${text.value.trim()}`;
    if (hexRgb(typed)) picker.value = typed.toLowerCase();
    wrap.dispatchEvent(new Event('change', { bubbles: true }));
  });
  wrap.append(picker, text);
  return {
    element: wrap,
    setDisabled(disabled) {
      picker.disabled = disabled || cfg.busy;
      text.disabled = disabled || cfg.busy;
    },
    value() {
      const typed = text.value.trim().startsWith('#') ? text.value.trim() : `#${text.value.trim()}`;
      return hexRgb(typed) ? typed.toUpperCase() : null;
    },
  };
}

// Simulación chica de cómo se ve en la app: aviso, rubro elegido, chip y botón.
function themePreview() {
  const box = el('div', 'cfg-preview');
  box.append(el('h4', 'cfg-subtitle', 'Así se ve en la app'));
  const phone = el('div', 'cfg-preview-phone');
  box.append(phone);
  function update(values) {
    phone.replaceChildren();
    const accent = values.accent || APP_ACCENT;
    const highlight = values.highlight || APP_HIGHLIGHT;
    const accentInk = inkOn(accent);
    const highlightInk = inkOn(highlight);
    if (values.bannerTitle) {
      const banner = el('div', 'cfg-preview-banner');
      banner.style.borderColor = softOf(accent);
      const badge = el('span', 'cfg-preview-badge');
      badge.style.background = accent;
      badge.style.color = accentInk;
      badge.append(mdiIcon(values.icon || 'party-popper', { size: 18 }));
      const copy = el('div', 'cfg-preview-banner-copy');
      copy.append(el('strong', '', values.bannerTitle));
      if (values.bannerText) copy.append(el('span', '', values.bannerText));
      banner.append(badge, copy);
      phone.append(banner);
    }
    const tiles = el('div', 'cfg-preview-tiles');
    [['broom', 'Limpieza', true], ['water-pump', 'Plomería', false], ['flash', 'Electricidad', false]].forEach(([icon, label, selected]) => {
      const tile = el('div', `cfg-preview-tile${selected ? ' is-selected' : ''}`);
      const tileIcon = el('span', 'cfg-preview-tile-icon');
      if (selected) {
        tileIcon.style.background = highlight;
        tileIcon.style.color = highlightInk;
      }
      tileIcon.append(mdiIcon(icon, { size: 20 }));
      tile.append(tileIcon, el('span', '', label));
      tiles.append(tile);
    });
    const chips = el('div', 'cfg-preview-chips');
    const chipOn = el('span', 'cfg-preview-chip is-selected', 'Limpieza general ✓');
    chipOn.style.background = accent;
    chipOn.style.borderColor = accent;
    chipOn.style.color = accentInk;
    chips.append(chipOn, el('span', 'cfg-preview-chip', 'Vidrios'));
    const progress = el('div', 'cfg-preview-progress');
    const fill = el('span', '');
    fill.style.background = accent;
    progress.append(fill);
    const cta = el('div', 'cfg-preview-button', 'Pedir ahora');
    cta.style.background = accent;
    cta.style.color = accentInk;
    const link = el('span', 'cfg-preview-link', 'Ver más rubros');
    link.style.color = textOnLight(accent);
    phone.append(tiles, progress, chips, cta, link);
  }
  return { element: box, update };
}

function renderThemeForm(ctx, theme) {
  const form = el('form', 'cfg-form');
  const name = input(theme.name, { maxLength: 40 });
  const icon = iconField(theme.icon, { title: `Ícono de ${theme.name}`, onChange: () => refresh() });
  const order = input(theme.sort_order, { type: 'number', step: 1 });
  const accent = colorField(theme.accent, 'Color de acento');
  const ownHighlight = checkbox('Usar un color propio (si no, queda el lima de siempre)', Boolean(theme.highlight));
  const highlight = colorField(theme.highlight || APP_HIGHLIGHT, 'Color de resaltado');
  highlight.setDisabled(!theme.highlight);
  const contrastHint = el('small', 'cfg-hint');
  const bannerTitle = input(theme.banner_title, { maxLength: 40, placeholder: 'Por ejemplo "¡Felices fiestas!"' });
  const bannerText = input(theme.banner_text, { maxLength: 120, placeholder: 'Opcional' });
  const effect = el('select', 'text-input');
  effect.disabled = cfg.busy;
  EFFECTS.forEach(([value, text]) => {
    const option = el('option', '', text);
    option.value = value;
    option.selected = (theme.effect || 'none') === value;
    effect.append(option);
  });
  const startsOn = input(theme.starts_on, { type: 'date' });
  const endsOn = input(theme.ends_on, { type: 'date' });
  const yearly = checkbox('Se repite todos los años (el año no importa)', theme.repeats_yearly);

  const basics = el('div', 'cfg-grid');
  basics.append(field('Nombre', name), field('Ícono', icon.element), field('Orden (si coinciden, gana el menor)', order));
  const colorsGrid = el('div', 'cfg-grid');
  colorsGrid.append(
    field('Acento (botones, pestañas, elegidos)', accent.element, contrastHint),
    field('Resaltado (ícono del rubro, pasos hechos)', highlight.element, ownHighlight.label)
  );
  const banner = el('div', 'cfg-grid');
  banner.append(
    field('Título del aviso', bannerTitle, 'Sin título no se muestra el aviso. Cada persona lo puede cerrar.'),
    field('Texto del aviso', bannerText)
  );
  const when = el('div', 'cfg-grid');
  when.append(field('Desde', startsOn), field('Hasta', endsOn));

  form.append(
    el('h4', 'cfg-subtitle', 'Datos'),
    basics,
    el('h4', 'cfg-subtitle', 'Colores'),
    colorsGrid,
    el('h4', 'cfg-subtitle', 'Aviso en el inicio'),
    banner,
    field('Animación al abrir la app (una vez, unos segundos)', effect),
    el('h4', 'cfg-subtitle', 'Fechas (en modo Automático)'),
    when,
    yearly.label
  );

  const actions = el('div', 'cfg-actions');
  actions.append(
    button('Borrar tema', 'danger-button', () => {
      if (!window.confirm(`¿Borrar el tema "${theme.name}"? Queda en el historial.`)) return;
      cfg.open = null;
      void save(ctx, () => ctx.supabase.from('app_themes').delete().eq('id', theme.id).select('id'), `Borramos ${theme.name}.`);
    }),
    el('span', 'cfg-actions-gap'),
    button('Cancelar', 'secondary-button', () => {
      cfg.open = null;
      ctx.rerender();
    }),
    button('Guardar tema', 'primary-button', null, 'submit')
  );
  form.append(actions);

  const preview = themePreview();
  function refresh() {
    highlight.setDisabled(!ownHighlight.box.checked);
    const color = accent.value();
    if (!color) {
      contrastHint.textContent = 'Escribí el color como #RRGGBB.';
      contrastHint.classList.add('is-warn');
    } else if (contrast(color, '#FFFFFF') < 3) {
      contrastHint.textContent = 'Es muy claro: en los textos y pestañas la app lo oscurece para que se lea.';
      contrastHint.classList.add('is-warn');
    } else {
      contrastHint.textContent = 'Se lee bien sobre blanco.';
      contrastHint.classList.remove('is-warn');
    }
    preview.update({
      accent: color,
      highlight: ownHighlight.box.checked ? highlight.value() : null,
      icon: icon.value(),
      bannerTitle: bannerTitle.value.trim(),
      bannerText: bannerText.value.trim(),
    });
  }
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const accentValue = accent.value();
    const highlightValue = ownHighlight.box.checked ? highlight.value() : null;
    if (name.value.trim().length < 2) return ctx.toast('Completá el nombre del tema.');
    if (!accentValue) return ctx.toast('El acento tiene que ser un color como #C62828.');
    if (ownHighlight.box.checked && !highlightValue) return ctx.toast('El resaltado tiene que ser un color como #FFD54F.');
    if (!icon.value()) return ctx.toast('Elegí un ícono.');
    const title = bannerTitle.value.trim();
    if (title && title.length < 2) return ctx.toast('El título del aviso es muy corto.');
    if (Boolean(startsOn.value) !== Boolean(endsOn.value)) return ctx.toast('Completá las dos fechas o ninguna.');
    if (startsOn.value && !yearly.box.checked && startsOn.value > endsOn.value) return ctx.toast('La fecha "Desde" tiene que ser anterior a "Hasta".');
    void save(ctx, () => ctx.supabase
      .from('app_themes')
      .update({
        name: name.value.trim(),
        icon: icon.value(),
        accent: accentValue,
        highlight: highlightValue,
        banner_title: title || null,
        banner_text: bannerText.value.trim() || null,
        effect: effect.value,
        starts_on: startsOn.value || null,
        ends_on: endsOn.value || null,
        repeats_yearly: yearly.box.checked,
        sort_order: numberOrNull(order.value) ?? 0,
      })
      .eq('id', theme.id)
      .select('id'), `Guardamos ${name.value.trim()}.`);
  });

  return { form, preview: preview.element };
}

function renderThemes(ctx, panel) {
  const current = cfg.data.activeTheme;
  const toolbar = el('div', 'cfg-toolbar');
  toolbar.append(el('p', 'muted', 'Cambian el color de acento de la app y suman un aviso y una animación en fechas especiales. Se ve uno solo a la vez: primero el que esté Prendido; si no hay, el Automático que esté en fecha.'));
  if (!cfg.adding) {
    toolbar.append(button('Agregar tema', 'primary-button', () => {
      cfg.adding = true;
      ctx.rerender();
    }));
  }
  panel.append(toolbar);

  const now = el('div', 'cfg-card cfg-theme-now');
  if (current) {
    now.append(themeSwatch(current));
    const copy = el('div', 'cfg-card-copy');
    copy.append(el('span', 'cfg-card-meta', 'AHORA EN LA APP'), el('strong', '', current.name));
    now.append(copy);
  } else {
    const swatch = themeSwatch({ accent: APP_ACCENT, icon: 'home-outline', name: 'U' });
    const copy = el('div', 'cfg-card-copy');
    copy.append(el('span', 'cfg-card-meta', 'AHORA EN LA APP'), el('strong', '', 'Colores de siempre'));
    now.append(swatch, copy);
  }
  panel.append(now);

  if (cfg.adding) {
    const form = el('form', 'cfg-card cfg-add-card');
    const name = input('', { maxLength: 40, placeholder: 'Por ejemplo "Aniversario UVR"' });
    form.append(field('Nombre del tema nuevo', name, 'Se crea apagado: elegí colores y fechas y después prendelo.'));
    const actions = el('div', 'cfg-actions');
    actions.append(
      button('Cancelar', 'secondary-button', () => {
        cfg.adding = false;
        ctx.rerender();
      }),
      button('Crear tema', 'primary-button', null, 'submit')
    );
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = name.value.trim();
      if (text.length < 2) return ctx.toast('Escribí el nombre del tema.');
      const id = uniqueId(slugify(text) || 'tema', new Set(cfg.data.themes.map((theme) => theme.id)));
      const order = Math.max(0, ...cfg.data.themes.map((theme) => theme.sort_order || 0)) + 10;
      const created = await save(ctx, () => ctx.supabase
        .from('app_themes')
        .insert({ id, name: text, icon: 'party-popper', accent: '#C62828', banner_title: text.slice(0, 40), sort_order: order, mode: 'off' })
        .select('id'), `Creamos ${text}. Elegí los colores y las fechas.`);
      if (created) {
        cfg.adding = false;
        cfg.open = `theme:${id}`;
        ctx.rerender();
      }
    });
    panel.append(form);
  }

  const list = el('div', 'cfg-list');
  cfg.data.themes.forEach((theme) => {
    const open = cfg.open === `theme:${theme.id}`;
    const [status, tone] = themeStatus(theme);
    const card = el('article', `cfg-card${theme.mode === 'off' ? ' is-off' : ''}${open ? ' is-open' : ''}`);
    const head = el('div', 'cfg-card-head');
    const copy = el('div', 'cfg-card-copy');
    const title = el('div', 'cfg-card-title');
    title.append(el('strong', '', theme.name), chip(status, tone));
    const effect = EFFECTS.find(([value]) => value === theme.effect)?.[1] || 'Sin animación';
    copy.append(title, el('span', 'cfg-card-meta', `${themeDates(theme)} · ${effect}`));
    if (theme.banner_title) copy.append(el('span', 'cfg-card-meta', `Aviso: ${theme.banner_title}`));
    const actions = el('div', 'cfg-card-actions');
    actions.append(
      modeControl(ctx, theme),
      button(open ? 'Cerrar' : 'Editar', 'secondary-button', () => {
        cfg.open = open ? null : `theme:${theme.id}`;
        ctx.rerender();
      })
    );
    head.append(themeSwatch(theme), copy, actions);
    card.append(head);
    if (open) {
      const body = el('div', 'cfg-card-body');
      const { form, preview } = renderThemeForm(ctx, theme);
      body.append(form, preview);
      card.append(body);
    }
    list.append(card);
  });
  panel.append(list);
}

// ---------- Historial ----------

function displayValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) {
    if (key === 'category_ids') {
      const names = Object.fromEntries((cfg.data?.categories || []).map((item) => [item.id, item.short_name || item.name]));
      return value.map((item) => names[item] || item).join(', ') || 'Todos los rubros';
    }
    const names = Object.fromEntries([...LEGACY_MATERIALS, ...UNITS]);
    return value.map((item) => names[item] || item).join(', ') || '—';
  }
  if (['per_job', 'per_visit', 'per_hour', 'reward'].includes(key)) return money(value);
  if (['fee_discount', 'surge_fee_discount'].includes(key)) return `${Math.round(Number(value) * 100)} %`;
  if (['min_percent', 'fee_percent'].includes(key)) return `${value} %`;
  if (key === 'mode') return MODES.find(([id]) => id === value)?.[1] || String(value);
  if (key === 'effect') return EFFECTS.find(([id]) => id === value)?.[1] || String(value);
  return String(value);
}

function changedFields(change) {
  if (change.action !== 'update') return [];
  return Object.keys(change.after || {})
    .filter((key) => !['updated_at', 'created_at'].includes(key))
    .filter((key) => JSON.stringify(change.before?.[key]) !== JSON.stringify(change.after?.[key]));
}

function entityLabel(change) {
  const row = change.after || change.before || {};
  if (change.entity === 'category_pricing') {
    const category = cfg.data?.categories.find((item) => item.id === row.category_id);
    return category?.short_name || category?.name || row.category_id;
  }
  if (change.entity === 'platform_settings') return 'Comisiones';
  if (change.entity === 'category_materials') {
    const category = cfg.data?.categories.find((item) => item.id === row.category_id);
    return `${row.label} · ${category?.short_name || category?.name || row.category_id}`;
  }
  return row.short_name || row.name || row.label || row.title || change.entity_id;
}

function renderHistory(ctx, panel) {
  if (cfg.history === null && !cfg.historyLoading) void loadHistory(ctx);
  panel.append(el('p', 'muted cfg-intro', 'Cada cambio queda registrado con quién lo hizo. Podés deshacer una edición y la fila vuelve a como estaba.'));
  if (!cfg.history) {
    panel.append(el('p', 'muted', 'Cargando historial…'));
    return;
  }
  if (!cfg.history.length) {
    panel.append(el('p', 'muted', 'Todavía no hay cambios.'));
    return;
  }
  const list = el('div', 'cfg-history');
  cfg.history.forEach((change) => {
    const item = el('article', 'cfg-history-item');
    const head = el('div', 'cfg-history-head');
    const title = el('div', 'cfg-card-title');
    title.append(
      chip(ENTITY_NAMES[change.entity] || change.entity),
      el('strong', '', entityLabel(change)),
      chip(change.action === 'insert' ? 'Alta' : change.action === 'delete' ? 'Baja' : 'Edición', change.action === 'update' ? '' : 'ok')
    );
    const meta = el('span', 'cfg-card-meta', `${change.actor_name} · ${formatWhen(change.created_at)}`);
    const copy = el('div', 'cfg-card-copy');
    copy.append(title, meta);
    head.append(copy);
    if (change.action === 'update') {
      head.append(button('Deshacer', 'secondary-button', () => {
        if (!window.confirm(`¿Volver "${entityLabel(change)}" a como estaba antes de este cambio?`)) return;
        void save(ctx, () => ctx.supabase.rpc('admin_restore_config', { p_audit_id: change.id }), 'Cambio deshecho.');
      }));
    }
    item.append(head);
    const fields = changedFields(change);
    if (fields.length) {
      const diff = el('ul', 'cfg-diff');
      fields.forEach((key) => {
        const line = el('li', '');
        line.append(
          el('span', 'cfg-diff-key', FIELD_NAMES[key] || key),
          el('span', 'cfg-diff-old', displayValue(key, change.before?.[key])),
          el('span', 'cfg-diff-arrow', '→'),
          el('span', 'cfg-diff-new', displayValue(key, change.after?.[key]))
        );
        diff.append(line);
      });
      item.append(diff);
    }
    list.append(item);
  });
  panel.append(list);
}

// ---------- Página ----------

export function resetConfigPage() {
  cfg.data = null;
  cfg.history = null;
  cfg.open = null;
  cfg.adding = false;
}

export function renderConfigPage(content, ctx) {
  void loadIcons();
  const hero = el('section', 'team-hero');
  const intro = el('div', 'team-hero-copy');
  intro.append(
    el('p', 'eyebrow', 'ACCESO PRIVADO · SOLO PROPIETARIO'),
    el('h1', '', 'Configuración de la app'),
    el('p', '', 'Rubros, tareas, precios, requisitos, funciones y temas de temporada. Lo que cambies acá lo ve la app en pocos minutos y queda en el historial.')
  );
  const note = el('div', 'team-hero-note');
  note.append(el('span', '', 'CAMBIOS AUDITADOS'), el('strong', '', 'Se pueden deshacer'));
  hero.append(intro, note);
  content.append(hero);

  const tabs = el('div', 'cfg-tabs');
  tabs.setAttribute('role', 'tablist');
  TABS.forEach(([id, text]) => {
    const tab = el('button', `cfg-tab${cfg.tab === id ? ' is-active' : ''}`, text);
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(cfg.tab === id));
    tab.addEventListener('click', () => {
      cfg.tab = id;
      cfg.adding = false;
      cfg.open = null;
      if (id === 'history') cfg.history = null;
      ctx.rerender();
    });
    tabs.append(tab);
  });
  content.append(tabs);

  const panel = el('section', 'cfg-panel');
  panel.setAttribute('role', 'tabpanel');
  content.append(panel);

  if (cfg.error) {
    panel.append(el('p', 'feedback error', cfg.error));
    panel.append(button('Reintentar', 'secondary-button', () => void load(ctx)));
    return;
  }
  if (!cfg.data) {
    if (!cfg.loading) void load(ctx);
    panel.append(el('p', 'muted', 'Cargando configuración…'));
    return;
  }

  if (cfg.tab === 'categories') renderCategories(ctx, panel);
  else if (cfg.tab === 'requirements') renderRequirements(ctx, panel);
  else if (cfg.tab === 'features') renderFeatures(ctx, panel);
  else if (cfg.tab === 'fees') renderFees(ctx, panel);
  else if (cfg.tab === 'themes') renderThemes(ctx, panel);
  else renderHistory(ctx, panel);
}
