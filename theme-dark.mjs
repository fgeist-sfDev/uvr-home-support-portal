// Genera el tema oscuro a partir de style.css en cada build: los fondos claros pasan a superficies
// oscuras, los textos oscuros a claros y lo que ya es oscuro o saturado (menú, botones lima,
// burbujas del equipo) queda igual. Así el modo oscuro no se desfasa cuando cambia el CSS.

const DARK = ':root[data-theme="dark"]';
const HEX = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;

const roleOf = (property) => {
  if (property === 'color' || property === 'fill' || property === 'stroke' || property === 'caret-color'
    || property.startsWith('text-decoration') || property === 'text-shadow' || property === '-webkit-text-fill-color') return 'text';
  if (property.startsWith('background')) return 'bg';
  if (property === 'box-shadow') return 'shadow';
  if ((property.startsWith('border') && !property.includes('radius') && !property.includes('collapse') && !property.includes('spacing'))
    || property.startsWith('outline') || property === 'column-rule' || property === 'accent-color') return 'border';
  return null;
};
const customRoles = {
  '--ink': 'text', '--muted': 'text', '--tone': 'text',
  '--surface': 'bg', '--surface-soft': 'bg', '--tone-soft': 'bg', '--line': 'border',
};

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function parseHex(hex) {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
}

function toOklch({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToRgb(L, C, h) {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function toHex(L, C, h, a) {
  let chroma = C;
  let rgb = oklchToRgb(L, chroma, h);
  // Si el color queda fuera del gamut sRGB, se baja la saturación hasta que entre.
  for (let i = 0; i < 24 && rgb.some((c) => c < -0.001 || c > 1.001); i += 1) {
    chroma *= 0.9;
    rgb = oklchToRgb(L, chroma, h);
  }
  const byte = (c) => Math.round(clamp(fromLinear(clamp(c))) * 255).toString(16).padStart(2, '0');
  const alpha = a < 1 ? Math.round(clamp(a) * 255).toString(16).padStart(2, '0') : '';
  return `#${rgb.map(byte).join('')}${alpha}`;
}

// Fondo oscuro o de color fuerte: es parte de la identidad y se mantiene igual en el tema oscuro.
const isKeptBackground = ({ L, C }, a) => a === 1 && (L < 0.52 || C > 0.1);
// Los grises claros pasan a grises oscuros con un leve tinte del verde de la marca.
const BRAND_HUE = (165 * Math.PI) / 180;
const tint = (C, h, amount) => (C < 0.012 ? [amount, BRAND_HUE] : [C, h]);

function transform(hex, role) {
  const rgba = parseHex(hex);
  const { L, C, h } = toOklch(rgba);
  const { a } = rgba;
  if (role === 'bg' || role === 'shadow-light') {
    if (a < 0.6) {
      // Tintes sutiles de hover pasan a luz tenue; los velos oscuros de diálogos quedan igual.
      if (L > 0.9 || a > 0.2) return hex;
      return L < 0.5 ? toHex(0.92, Math.min(C, 0.04), h, Math.min(1, a * 1.4)) : hex;
    }
    if (isKeptBackground({ L, C }, 1)) return hex;
    if (L >= 0.85) {
      const [chroma, hue] = tint(C, h, 0.012);
      return toHex(0.2 + (1 - L) * 0.72, C < 0.012 ? chroma : Math.min(0.06, C * 1.5 + 0.006), hue, a);
    }
    const [chroma, hue] = tint(C, h, 0.014);
    return toHex(clamp(1.12 - L, 0.3, 0.6), Math.min(chroma, 0.08), hue, a);
  }
  if (role === 'text') {
    if (L >= 0.66) return hex;
    const [chroma, hue] = tint(C, h, 0.01);
    return toHex(clamp(0.97 - (L - 0.2) * 0.5, 0.72, 0.95), Math.min(chroma, 0.12), hue, a);
  }
  if (role === 'border') {
    if (a < 1) return L < 0.5 ? toHex(0.92, Math.min(C, 0.04), h, a) : hex;
    if (L >= 0.6) {
      const [chroma, hue] = tint(C, h, 0.014);
      return toHex(0.3 + (1 - L) * 0.55, Math.min(chroma, 0.05), hue, a);
    }
    return C > 0.08 ? hex : toHex(clamp(1.1 - L, 0.35, 0.8), C, h, a);
  }
  if (role === 'shadow') {
    if (L > 0.85 && a === 1) return transform(hex, 'shadow-light');
    if (L < 0.4 && a < 1) return toHex(0.05, 0, 0, Math.min(1, a * 2.2));
    return hex;
  }
  return hex;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function matchingBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('theme-dark: llave sin cerrar en style.css');
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function scopeSelector(selector) {
  const trimmed = selector.trim();
  if (trimmed === ':root' || trimmed === 'html') return DARK;
  if (trimmed.startsWith(':root')) return DARK + trimmed.slice(5);
  return `${DARK} ${trimmed}`;
}

function darkRule(selectors, body) {
  const declarations = splitTopLevel(body, ';');
  const parsed = declarations.map((declaration) => {
    const index = declaration.indexOf(':');
    if (index < 0) return null;
    const property = declaration.slice(0, index).trim().toLowerCase();
    return { property, value: declaration.slice(index + 1).trim() };
  }).filter(Boolean);
  const keptContext = parsed.some(({ property, value }) => roleOf(property) === 'bg'
    && (/var\(--(lime|forest|forest-deep|banner)\)/.test(value) || [...value.matchAll(HEX)].some(([hex]) => {
      const rgba = parseHex(hex);
      return isKeptBackground(toOklch(rgba), rgba.a);
    })));
  const output = [];
  for (const { property, value } of parsed) {
    const role = property.startsWith('--') ? customRoles[property] : roleOf(property);
    if (!role) continue;
    let next = value;
    // Sobre fondos que no cambian (lima, verde bosque) el texto se repite tal cual.
    if (role !== 'text' || !keptContext) {
      if (role === 'text') next = next.replace(/var\(--forest(-deep)?\)/g, 'var(--accent-ink)');
      next = next.replace(HEX, (hex) => transform(hex, role));
    }
    // Se repiten también las declaraciones sin cambios para no alterar la cascada entre reglas.
    output.push(`${property}: ${next}`);
  }
  if (!output.length) return '';
  return `${selectors.map(scopeSelector).join(', ')} { ${output.join('; ')}; }`;
}

function walk(css) {
  const out = [];
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf('{', index);
    if (open < 0) break;
    const prelude = css.slice(index, open).trim();
    const close = matchingBrace(css, open);
    const inner = css.slice(open + 1, close);
    index = close + 1;
    if (prelude.startsWith('@media') || prelude.startsWith('@container') || prelude.startsWith('@supports')) {
      const nested = walk(inner);
      if (nested) out.push(`${prelude} {\n${nested}\n}`);
    } else if (!prelude.startsWith('@')) {
      const rule = darkRule(splitTopLevel(prelude, ','), inner);
      if (rule) out.push(rule);
    }
  }
  return out.join('\n');
}

export function buildDarkTheme(css) {
  return walk(stripComments(css));
}

export default function darkThemePlugin() {
  return {
    name: 'uvr-dark-theme',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]src[\\/]style\.css(\?|$)/.test(id)) return null;
      return { code: `${code}\n\n/* Tema oscuro generado por theme-dark.mjs */\n${buildDarkTheme(code)}\n`, map: null };
    },
  };
}
