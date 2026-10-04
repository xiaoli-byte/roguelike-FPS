(() => {
  const sheets = [...document.querySelectorAll('[data-plan]')];
  const ids = new Set(sheets.map(s => s.dataset.plan));
  let selected = ids.has(location.hash.slice(1)) ? location.hash.slice(1) : 'desert-1';
  let mode = location.hash === '#gallery' ? 'gallery' : location.hash === '#method' ? 'method' : 'detail';
  function render() {
    for (const s of sheets) s.hidden = s.dataset.plan !== selected;
    document.querySelectorAll('[data-view]').forEach(e => e.hidden = e.dataset.view !== mode);
    document.querySelectorAll('[data-select]').forEach(e => e.setAttribute('aria-pressed', String(e.dataset.select === selected)));
    document.querySelectorAll('[data-mode]').forEach(e => e.setAttribute('aria-pressed', String(e.dataset.mode === mode)));
    const title = document.querySelector(`[data-plan="${selected}"] h1`).textContent;
    document.title = `${mode === 'detail' ? title : mode === 'gallery' ? '15 关同尺度对比' : '设计依据'} · 关卡平面图册`;
  }
  function change(nextMode, id = selected) {
    selected = id; mode = nextMode;
    history.replaceState(null, '', `#${mode === 'detail' ? selected : mode}`);
    render(); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  document.querySelectorAll('[data-select]').forEach(e => e.addEventListener('click', () => change('detail', e.dataset.select)));
  document.querySelectorAll('[data-mode]').forEach(e => e.addEventListener('click', () => change(e.dataset.mode)));
  document.querySelectorAll('[data-toggle]').forEach(e => e.addEventListener('change', () => {
    document.querySelectorAll(`[data-layer="${e.dataset.toggle}"]`).forEach(layer => layer.style.display = e.checked ? '' : 'none');
  }));
  document.getElementById('print').addEventListener('click', () => window.print());
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1);
    if (ids.has(hash)) { selected = hash; mode = 'detail'; }
    else if (hash === 'gallery' || hash === 'method') mode = hash;
    render();
  });
  render();
})();
