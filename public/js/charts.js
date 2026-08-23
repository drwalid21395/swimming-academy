'use strict';
/* رسوم بيانية بسيطة بدون مكتبات خارجية */
(function () {
  const G = {
    blue: '#0b6ec7', cyan: '#22c3e8', green: '#17a34a', amber: '#d97706',
    red: '#dc2626', purple: '#7c3aed', gray: '#94a3b8'
  };
  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentNode ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
    const w = canvas.width || rect.width || 300;
    const h = canvas.height || rect.height || 200;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function maxData(datasets) {
    let m = 0;
    datasets.forEach(ds => (ds.data || []).forEach(v => { if (Number(v) > m) m = Number(v); }));
    return m;
  }

  function drawBars(canvas, labels, datasets, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const pad = { t: 18, r: 8, b: 26, l: 34 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const max = maxData(datasets) * 1.12 || 1;
    const n = labels.length;
    const groupW = cw / n;
    const barW = groupW / (datasets.length + 1);
    ctx.font = '11px Cairo, Segoe UI';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(128,140,160,.25)';
    ctx.fillStyle = cssVar('--text-3', '#8aa0b4');
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ch - (ch * i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
      ctx.fillStyle = cssVar('--text-3', '#8aa0b4');
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(max * i / 4).toLocaleString('ar-EG'), pad.l - 7, y);
    }
    ctx.textAlign = 'center';
    labels.forEach((lb, i) => {
      datasets.forEach((ds, d) => {
        const x = pad.l + groupW * i + groupW * (d + 0.5) / (datasets.length + 1) - barW / 2 + groupW / (2 * (datasets.length + 1));
        const v = Number(ds.data[i] || 0);
        const bh = (v / max) * ch;
        const y = pad.t + ch - bh;
        ctx.fillStyle = ds.color || G.blue;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, barW, bh, 4) : ctx.rect(x, y, barW, bh);
        ctx.fill();
      });
      ctx.fillStyle = cssVar('--text-2', '#5b6b7b');
      ctx.fillText(lb, pad.l + groupW * i + groupW / 2, pad.t + ch + 16);
    });
    ctx.textAlign = 'right';
  }

  function drawLine(canvas, labels, datasets, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const pad = { t: 18, r: 14, b: 26, l: 36 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const max = maxData(datasets) * 1.12 || 1;
    const n = labels.length;
    ctx.font = '11px Cairo, Segoe UI';
    ctx.strokeStyle = 'rgba(128,140,160,.25)';
    ctx.fillStyle = cssVar('--text-3', '#8aa0b4');
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ch - (ch * i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
      ctx.fillStyle = cssVar('--text-3', '#8aa0b4');
      ctx.fillText(Math.round(max * i / 4).toLocaleString('ar-EG'), pad.l - 6, y);
    }
    const step = n > 1 ? cw / (n - 1) : 0;
    datasets.forEach(ds => {
      ctx.strokeStyle = ds.color || G.blue;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      (ds.data || []).forEach((v, i) => {
        const x = pad.l + step * i, y = pad.t + ch - (Number(v) / max) * ch;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = ds.color || G.blue;
      (ds.data || []).forEach((v, i) => {
        const x = pad.l + step * i, y = pad.t + ch - (Number(v) / max) * ch;
        ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
      });
    });
    ctx.fillStyle = cssVar('--text-2', '#5b6b7b');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    labels.forEach((lb, i) => ctx.fillText(lb, pad.l + step * i, pad.t + ch + 16));
  }

  function drawPie(canvas, items, opts) {
    opts = opts || {};
    const { ctx, w, h } = setup(canvas);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - 12;
    const total = items.reduce((s, it) => s + (Number(it.value) || 0), 0) || 1;
    let a0 = -Math.PI / 2;
    items.forEach((it, i) => {
      const a1 = a0 + (Number(it.value) / total) * Math.PI * 2;
      ctx.fillStyle = it.color || G.blue;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fill();
      a0 = a1;
    });
    ctx.fillStyle = cssVar('--surface', '#fff');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cssVar('--text', '#1c2b3a');
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px Cairo, Segoe UI';
    ctx.fillText(total.toLocaleString('ar-EG'), cx, cy);
    ctx.font = '11px Cairo, Segoe UI';
    ctx.fillStyle = cssVar('--text-3', '#8aa0b4');
    ctx.fillText(opts.centerLabel || 'الإجمالي', cx, cy + 18);
  }

  function legend(items, el) {
    if (!el) return;
    el.innerHTML = items.map(it =>
      `<div style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-2);margin:4px 0;">
        <span style="width:11px;height:11px;border-radius:3px;background:${it.color};display:inline-block;"></span>
        ${it.label}: <b style="color:var(--text);margin-inline-start:4px;">${Number(it.value || 0).toLocaleString('ar-EG')}</b>
      </div>`).join('');
  }

  window.SwimCharts = { drawBars, drawLine, drawPie, legend, G, colors: G };
})();
