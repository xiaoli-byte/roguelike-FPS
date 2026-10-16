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
  const frame = typeof fixedScale === 'number' ? fixedScale : 200;
  const vw = fixedScale ? frame : w + 8, vh = fixedScale ? frame : h + 8;
  const offX = fixedScale ? (frame - w) / 2 : 4, offY = fixedScale ? (frame - h) / 2 : 4;
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
  const rewardNames = { coins: '金币', scroll: '秘卷', weapon: '武器', heal: '恢复', upgrade: '首领奖励' };
  const rewards = plan.rewards.map(r => `<g><title>${esc(`${r.label} · ${rewardNames[r.reward] ?? '物资'} · 解锁 ${r.requires?.join(' / ') ?? '探索'}`)}</title><path d="M${r.at[0]} ${r.at[1] - 1.8}l1.8 1.8-1.8 1.8-1.8-1.8z" fill="#b58a26" stroke="#fff" stroke-width=".45"/>${compact ? '' : text([r.at[0], r.at[1] + 3.8], `${rewardNames[r.reward] ?? '物资'} · ${r.requires?.join('/') ?? ''}`, 'note', 1.5)}</g>`).join('');
  const merchant = plan.preparation ? `<g><title>${esc(plan.preparation.label)} · 武器、秘卷、强化、恢复、弹药</title><rect x="${plan.preparation.at[0] - 3}" y="${plan.preparation.at[1] - 3}" width="6" height="6" rx=".8" fill="#277b74" stroke="#fff" stroke-width=".5"/>${text([plan.preparation.at[0], plan.preparation.at[1] + 1], '商', 'portal', 2.6)}</g>` : '';
  // V2 plans: raised decks with their stepped stairs, and covers drawn by what they are (low wall, model, gate, shrine).
  const STEP_RISE = .4, STEP_DEPTH = .65, v2 = Boolean(plan.platforms?.length || plan.covers.some(c => c.art || (c.height ?? 2.6) !== 2.6));
  const platforms = (plan.platforms ?? []).map(d => {
    const [ax, ay, bx, by] = d.rect, x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, run = (Math.max(2, Math.round(d.height / STEP_RISE)) - 1) * STEP_DEPTH;
    const stairs = d.stairs.map(st => {
      const o = st.offset ?? 0, half = st.width / 2;
      const [sx, sy, sw, sh, arrow] = st.side === 'east' ? [x1, cy + o - half, run, st.width, [x1 + run - .4, cy + o, x1 + .6, cy + o]]
        : st.side === 'west' ? [x0 - run, cy + o - half, run, st.width, [x0 - run + .4, cy + o, x0 - .6, cy + o]]
          : st.side === 'south' ? [cx + o - half, y1, st.width, run, [cx + o, y1 + run - .4, cx + o, y1 + .6]]
            : [cx + o - half, y0 - run, st.width, run, [cx + o, y0 - run + .4, cx + o, y0 - .6]];
      return `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="url(#${uid}-steps)" stroke="#8a6d43" stroke-width=".3"/><line x1="${arrow[0]}" y1="${arrow[1]}" x2="${arrow[2]}" y2="${arrow[3]}" stroke="#6b5230" stroke-width=".35" marker-end="url(#${uid}-up)"/>`;
    }).join('');
    return `<g><title>${esc(`${d.label} · 高 ${d.height}m · 台阶 ${d.stairs.length} 处`)}</title><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#e9d6b2" stroke="#8a6d43" stroke-width=".45"/>${stairs}${compact ? '' : text([cx, cy + .6], `${d.height}m`, 'deck', 1.7)}</g>`;
  }).join('');
  // Voids (lava, ice holes): every non-floor cell inside a void circle is open (an ice hole is fenced, lava is a damaging
  // floor), so drawing the circles under the floor shows exactly the open area. Hazard strips are drawn over the floor:
  // lava strips are runtime lava (round-capped like WhiteboxGen's capsules), flame lanes are planned only.
  const voids = (plan.voids ?? []).map(v => `<circle cx="${v.center[0]}" cy="${v.center[1]}" r="${v.radius}" fill="${v.kind === 'lava' ? '#e8834a' : '#a9cbd9'}"><title>${esc(v.label)}</title></circle>`).join('');
  const hazards = (plan.hazards ?? []).map(z => `<g><title>${esc(`${z.label} · ${z.note}`)}</title><polyline points="${points(z.points)}" fill="none" stroke="${z.kind === 'lava' ? '#e8834a' : '#d9534f'}" stroke-opacity="${z.kind === 'lava' ? 1 : .75}" stroke-width="${z.width}" stroke-linecap="${z.kind === 'lava' ? 'round' : 'butt'}" stroke-linejoin="round"/></g>`).join('');
  const artNames = { stall: '摊位', goods: '货堆', hoard: '财宝堆', ruin: '倒塌柱段', brazier: '火盆', gate: '门楼', shrine: '传送门神龛' };
  const cover = c => {
    const h = c.height ?? 2.6, kind = c.art === 'gate' || c.art === 'shrine' ? 'structure' : c.art ? 'prop' : h <= 1.5 ? 'low' : 'solid';
    const fill = { structure: '#3d5160', prop: '#b99a6b', low: `url(#${uid}-low)`, solid: `url(#${uid}-hatch)` }[kind];
    const label = c.art ? `${artNames[c.art] ?? c.art}，高 ${h}m` : h <= 1.5 ? `低墙，高 ${h}m，可翻越` : `实体遮挡，高 ${h}m`;
    return `<polygon points="${points(c.polygon)}" fill="${fill}" stroke="#435867" stroke-width=".4"><title>${esc(label)}</title></polygon>`;
  };
  return `${document ? '<?xml version="1.0" encoding="UTF-8"?>' : ''}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="${esc(plan.title)}平面设计图" class="floor-plan">
  <title>${esc(plan.title)} — ${esc(plan.subtitle)}</title><desc>${esc(plan.identity)}。单位为米。对应技术白盒已接入独立试玩入口，完整可玩性与平衡仍在验证。</desc>
  <defs><pattern id="${uid}-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#a5bbc8" stroke-width=".13"/></pattern>
  <pattern id="${uid}-hatch" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="1.4" height="1.4" fill="#738693"/><path d="M0 0V1.4" stroke="#d1dce1" stroke-width=".35"/></pattern>
  ${v2 ? `<pattern id="${uid}-low" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="1.4" height="1.4" fill="#a9b8c1"/><path d="M0 0V1.4" stroke="#eef3f5" stroke-width=".35"/></pattern>
  <pattern id="${uid}-steps" width=".65" height=".65" patternUnits="userSpaceOnUse"><rect width=".65" height=".65" fill="#dcc398"/><path d="M0 0H.65M0 0V.65" stroke="#a8875a" stroke-width=".12"/></pattern>
  <marker id="${uid}-up" markerWidth="4" markerHeight="4" refX="3.7" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0 0L4 2 0 4" fill="#6b5230"/></marker>` : ''}${[['main','#087eaa'],['optional','#47836b'],['return','#825d98'],['threat','#b54a48']].map(([kind,c]) => `<marker id="${uid}-${kind}" markerWidth="4" markerHeight="4" refX="3.7" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0 0L4 2 0 4" fill="${c}"/></marker>`).join('')}</defs>
  <style>text{font-family:'Microsoft YaHei','PingFang SC',sans-serif;fill:#294455;text-anchor:middle;pointer-events:none}.room-label{paint-order:stroke;stroke:#f7faf8;stroke-width:.9;stroke-linejoin:round}.dim{fill:#526978;paint-order:stroke;stroke:#dce6ec;stroke-width:.8}.portal{fill:white;font-family:Consolas,monospace;font-weight:bold}.note{fill:#465f6c;paint-order:stroke;stroke:#dce6ec;stroke-width:1}${v2 ? '.deck{fill:#6b5230;font-weight:bold;paint-order:stroke;stroke:#e9d6b2;stroke-width:.6}' : ''}</style>
  <rect width="${vw}" height="${vh}" fill="${field}"/><g transform="translate(${offX} ${offY})">
  ${voids}${passagePolys(edge, 1.1)}${roomPolys(edge, edge, 1.1)}${passagePolys(floor, 0)}${roomPolys(floor, 'none')}
  <rect width="${w}" height="${h}" fill="url(#${uid}-grid)"/>
  ${hazards}${platforms}${plan.covers.map(cover).join('')}
  <g data-layer="sightlines">${compact ? '' : sightlines}</g><g data-layer="routes">${routes}</g>
  ${compact ? '' : `<g data-layer="dimensions">${widths}</g><g data-layer="labels">${plan.rooms.map(r => text(r.labelAt, r.label, 'room-label', 2.2)).join('')}</g>`}
  <g data-layer="encounters">${compact ? '' : encounters}${rewards}${merchant}</g>${portal(plan.entry, 'S', '#277b74')}${portal(plan.exit, 'X', '#455a9e')}
  <g transform="translate(2 ${h - 1})"><path d="M0-1V0H10V-1M5 0V-1" stroke="#294455" stroke-width=".3" fill="none"/>${text([5,-1.8], '10m', '', 1.7)}</g>
  ${text([w - 4, 3], 'N ↑', '', 2)}
  </g></svg>`.replace(/[ \t]+$/gm, '');
}
