const SVG_NS = 'http://www.w3.org/2000/svg';

// Trazos de 24x24 con línea de 1.8; cada entrada es [etiqueta, atributos].
const shapes = {
  overview: [
    ['rect', { x: 3, y: 3, width: 7, height: 9, rx: 1.6 }],
    ['rect', { x: 14, y: 3, width: 7, height: 5, rx: 1.6 }],
    ['rect', { x: 14, y: 12, width: 7, height: 9, rx: 1.6 }],
    ['rect', { x: 3, y: 16, width: 7, height: 5, rx: 1.6 }],
  ],
  inbox: [
    ['path', { d: 'M22 12h-6l-2 3h-4l-2-3H2' }],
    ['path', { d: 'M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z' }],
  ],
  users: [
    ['circle', { cx: 9, cy: 8, r: 4 }],
    ['path', { d: 'M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1' }],
    ['path', { d: 'M16 3.5a4 4 0 0 1 0 8' }],
    ['path', { d: 'M22 21v-1a5 5 0 0 0-3-4.6' }],
  ],
  user: [
    ['circle', { cx: 12, cy: 8, r: 4 }],
    ['path', { d: 'M4 21a8 8 0 0 1 16 0' }],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  logout: [
    ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
    ['path', { d: 'm16 17 5-5-5-5' }],
    ['path', { d: 'M21 12H9' }],
  ],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.6-6.4L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  ticket: [
    ['path', { d: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z' }],
    ['path', { d: 'M13 5v2M13 17v2M13 11v2' }],
  ],
  bolt: [
    ['path', { d: 'M13 2 4 14h7l-1 8 9-12h-7z' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 7v5l3 2' }],
  ],
  trend: [
    ['path', { d: 'm3 17 6-6 4 4 8-8' }],
    ['path', { d: 'M15 7h6v6' }],
  ],
  queue: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.7' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  shield: [
    ['path', { d: 'M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z' }],
    ['path', { d: 'm9 12 2 2 4-4' }],
  ],
  check: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'm8 12 3 3 5-6' }],
  ],
  pause: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M10 9v6M14 9v6' }],
  ],
  panel: [
    ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.2 }],
    ['path', { d: 'M15 4v16' }],
  ],
  arrow: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'm13 6 6 6-6 6' }],
  ],
};

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${className ? ` ${className}` : ''}`);
  (shapes[name] || []).forEach(([tag, attributes]) => {
    const shape = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => shape.setAttribute(key, String(value)));
    svg.append(shape);
  });
  return svg;
}
