// SVG is a design drawing in metres, not a generator for runtime or art geometry.
export const chapterNames = { desert: '沙寺', frost: '霜山', inferno: '熔火' };
export const chapterColors = { desert: '#a07944', frost: '#4b8599', inferno: '#a75e58' };
export const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const points = value => value.map(p => p.join(',')).join(' ');
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const pathLength = path => path.points.slice(1).reduce((sum, p, i) => sum + distance(p, path.points[i]), 0);
export const polygonArea = poly => Math.abs(poly.reduce((sum, p, i) => {
  const q = poly[(i + 1) % poly.length]; return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;

export function planSvg(plan, { compact = false, fixedScale = false, suffix = '', document = false } = {}) {
  const uid = `${plan.id}${suffix}`, [w, h] = plan.bounds;
  const vw = fixedScale ? 150 : w + 8, vh = fixedScale ? 150 : h + 8;
  const offX = fixedScale ? (150 - w) / 2 : 4, offY = fixedScale ? (150 - h) / 2 : 4;
  const edge = '#587180', floor = '#f7faf8', field = '#dce6ec';
  const roomPolys = (fill, stroke, sw = 0) => plan.rooms.map(r => `<polygon points="${points(r.polygon)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`).join('');
  const passagePolys = (fill, more) => plan.passages.map(p => `<polyline points="${points(p.points)}" fill="none" stroke="${fill}" stroke-width="${p.width + more}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const text = (at, content, cls = '', size = 2.1) => `<text x="${at[0]}" y="${at[1]}" class="${cls}" font-size="${size}">${esc(content)}</text>`;
  const portal = (value, name, color) => `<g><circle cx="${value.at[0]}" cy="${value.at[1]}" r="2.1" fill="${color}" stroke="#fff" stroke-width=".5"/>${text([value.at[0], value.at[1] + .7], name, 'portal', 2.1)}</g>`;
  const routes = plan.passages.map(p => {
    const color = p.kind === 'main' ? '#087eaa' : p.kind === 'return' ? '#825d98' : '#47836b';
    return `<polyline points="${points(p.points)}" fill="none" stroke="${color}" stroke-width="${compact ? .8 : .6}" stroke-dasharray="${p.kind === 'main' ? 'none' : '1.7 1.2'}" stroke-linejoin="round" marker-end="url(#${uid}-${p.kind})"><title>${esc(p.note)}</title></polyline>`;
  }).join('');
  const widths = plan.passages.map(p => {
    let index = 0, longest = 0;
    for (let i = 0; i < p.points.length - 1; i++) { const l = distance(p.points[i], p.points[i + 1]); if (l > longest) { index = i; longest = l; } }
    const a = p.points[index], b = p.points[index + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = -dy / len, ny = dx / len;
    const q = [mx + nx * (p.width / 2 + 1.8), my + ny * (p.width / 2 + 1.8)];
    return `<g><line x1="${mx - nx * p.width / 2}" y1="${my - ny * p.width / 2}" x2="${mx + nx * p.width / 2}" y2="${my + ny * p.width / 2}" stroke="#718993" stroke-width=".22"/>${text(q, `${p.width}m`, 'dim', 1.65)}</g>`;
  }).join('');
  const encounters = plan.encounters.map(e => {
    const dx = e.facing[0] - e.at[0], dy = e.facing[1] - e.at[1], length = Math.hypot(dx, dy) || 1;
    const tip = [e.at[0] + dx / length * 6, e.at[1] + dy / length * 6];
    return `<g><title>${esc(`${e.id} ${e.label}：${e.roster}；${e.timing}`)}</title><line x1="${e.at[0]}" y1="${e.at[1]}" x2="${tip[0]}" y2="${tip[1]}" stroke="#b54a48" stroke-width=".55" marker-end="url(#${uid}-threat)"/><circle cx="${e.at[0]}" cy="${e.at[1]}" r="2.15" fill="#b54a48" stroke="#fff" stroke-width=".5"/>${text([e.at[0], e.at[1] + .75], e.id.length > 2 ? '首' : e.id, 'portal', 2.1)}</g>`;
  }).join('');
  const sightlines = plan.sightlines.map(l => `<g><line x1="${l.from[0]}" y1="${l.from[1]}" x2="${l.to[0]}" y2="${l.to[1]}" stroke="#b54a48" stroke-width=".38" stroke-dasharray="1.1 1.1"/><title>${esc(l.label)} · ${distance(l.from, l.to).toFixed(1)}m</title></g>`).join('');
  const rewards = plan.rewards.map(r => `<g><title>${esc(r.label)}</title><path d="M${r.at[0]} ${r.at[1] - 1.8}l1.8 1.8-1.8 1.8-1.8-1.8z" fill="#b58a26" stroke="#fff" stroke-width=".45"/></g>`).join('');
  return `${document ? '<?xml version="1.0" encoding="UTF-8"?>' : ''}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="${esc(plan.title)}平面设计图" class="floor-plan">
  <title>${esc(plan.title)} — ${esc(plan.subtitle)}</title><desc>${esc(plan.identity)}。单位为米。对应技术白盒已接入独立试玩入口，完整可玩性与平衡仍在验证。</desc>
  <defs><pattern id="${uid}-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#a5bbc8" stroke-width=".13"/></pattern>
  <pattern id="${uid}-hatch" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="1.4" height="1.4" fill="#738693"/><path d="M0 0V1.4" stroke="#d1dce1" stroke-width=".35"/></pattern>
  ${[['main','#087eaa'],['optional','#47836b'],['return','#825d98'],['threat','#b54a48']].map(([kind,c]) => `<marker id="${uid}-${kind}" markerWidth="4" markerHeight="4" refX="3.7" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0 0L4 2 0 4" fill="${c}"/></marker>`).join('')}</defs>
  <style>text{font-family:'Microsoft YaHei','PingFang SC',sans-serif;fill:#294455;text-anchor:middle;pointer-events:none}.room-label{paint-order:stroke;stroke:#f7faf8;stroke-width:.9;stroke-linejoin:round}.dim{fill:#526978;paint-order:stroke;stroke:#dce6ec;stroke-width:.8}.portal{fill:white;font-family:Consolas,monospace;font-weight:bold}.note{fill:#465f6c;paint-order:stroke;stroke:#dce6ec;stroke-width:1}</style>
  <rect width="${vw}" height="${vh}" fill="${field}"/><g transform="translate(${offX} ${offY})">
  ${passagePolys(edge, 1.1)}${roomPolys(edge, edge, 1.1)}${passagePolys(floor, 0)}${roomPolys(floor, 'none')}
  <rect width="${w}" height="${h}" fill="url(#${uid}-grid)"/>
  ${plan.covers.map(c => `<polygon points="${points(c.polygon)}" fill="url(#${uid}-hatch)" stroke="#435867" stroke-width=".4"><title>实体遮挡，高 ${c.height}m</title></polygon>`).join('')}
  <g data-layer="sightlines">${compact ? '' : sightlines}</g><g data-layer="routes">${routes}</g>
  ${compact ? '' : `<g data-layer="dimensions">${widths}</g><g data-layer="labels">${plan.rooms.map(r => text(r.labelAt, r.label, 'room-label', 2.2)).join('')}</g>`}
  <g data-layer="encounters">${compact ? '' : encounters}${rewards}</g>${portal(plan.entry, 'S', '#277b74')}${portal(plan.exit, 'X', '#455a9e')}
  <g transform="translate(2 ${h - 1})"><path d="M0-1V0H10V-1M5 0V-1" stroke="#294455" stroke-width=".3" fill="none"/>${text([5,-1.8], '10m', '', 1.7)}</g>
  ${text([w - 4, 3], 'N ↑', '', 2)}
  </g></svg>`.replace(/[ \t]+$/gm, '');
}
