// Renders the monthly PDF calendar: draws the MWA artwork (with its month-specific text
// erased — see scripts/build-pdf-template.py) onto a canvas, writes the selected month's
// data over it, and embeds each page into an A4 PDF. jsPDF is loaded lazily.
import bgUrl from '../assets/pdf-template-bg.jpg';
import logoUrl from '../assets/mwa-logo.png';

const W = 864, H = 1223, SCALE = 2;
const GREEN = '#0b3b2e', GOLD = '#b08d3f', CREAM_TXT = '#f6ecd0', INK = '#2d2d2d', NAVY = '#1b1b6b';
const SERIF = "'Playfair Display', 'Times New Roman', Georgia, serif";
const BODY = "'Times New Roman', 'Liberation Serif', Georgia, serif";
const ARABIC = "'Amiri', 'Noto Naskh Arabic', 'Traditional Arabic', 'Times New Roman', serif";

const COL = { x0: 28, x1: 838, c1: 110, c2: 267, c3: 590, eventHalf: 232 };
const ROWS_TOP = 664, ROWS_BOTTOM = 1040;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load PDF artwork'));
    img.src = src;
  });
}

async function ensureFonts() {
  if (!document.fonts?.load) return;
  const wants = [`700 40px 'Playfair Display'`, `700 40px 'Amiri'`, `400 40px 'Amiri'`];
  await Promise.all(wants.map(f => document.fonts.load(f, 'Aa ربيع').catch(() => null)));
}

function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

// Shrinks the font until the text fits maxW.
function fit(ctx, text, fontFn, size, maxW, min = 10) {
  let s = size;
  ctx.font = fontFn(s);
  while (ctx.measureText(text).width > maxW && s > min) { s -= 1; ctx.font = fontFn(s); }
  return s;
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Centered run of text segments where {sup:true} segments are small and raised (e.g. "10th").
function drawRich(ctx, segs, cx, y, size, color) {
  const supSize = size * 0.6;
  const widths = segs.map(s => { ctx.font = `${s.sup ? supSize : size}px ${BODY}`; return ctx.measureText(s.t).width; });
  let x = cx - widths.reduce((a, b) => a + b, 0) / 2;
  ctx.fillStyle = color; ctx.textAlign = 'left';
  segs.forEach((s, i) => {
    ctx.font = `${s.sup ? supSize : size}px ${BODY}`;
    ctx.fillText(s.t, x, s.sup ? y - size * 0.38 : y);
    x += widths[i];
  });
  ctx.textAlign = 'center';
}

const hijriSegs = h => (h ? [{ t: String(h.day) }, { t: h.suffix, sup: true }, { t: ` ${h.month}` }] : [{ t: '—' }]);
const gregSegs = g => [{ t: `${g.dow}, ${g.day}` }, { t: g.suffix, sup: true }, { t: ` ${g.month}` }];

function layoutRows(ctx, model) {
  const colW = COL.eventHalf * 2;
  const rows = model.rows.map(r => {
    const blocks = r.events.map(e => {
      ctx.font = `bold 21px ${BODY}`;
      const title = wrap(ctx, e.pending ? `${e.title} (Pending)` : e.title, colW);
      ctx.font = `15px ${BODY}`;
      const detail = wrap(ctx, e.detail, colW);
      const h = title.length * 24 + detail.length * 19 + (e.department ? 20 : 0);
      return { ...e, titleLines: title, detailLines: detail, h };
    });
    const content = blocks.reduce((n, b) => n + b.h, 0) + (blocks.length - 1) * 10;
    return { ...r, blocks, height: Math.max(60, content + 16) };
  });
  const pages = [[]];
  let y = ROWS_TOP;
  for (const r of rows) {
    if (y + r.height > ROWS_BOTTOM && pages[pages.length - 1].length) { pages.push([]); y = ROWS_TOP; }
    pages[pages.length - 1].push(r);
    y += r.height;
  }
  return pages;
}

function drawPage(ctx, { bg, logo }, model, rows, pageNo, pageCount) {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(bg, 0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Logo, centred under the association name over the ornament.
  const lh = 52, lw = lh * logo.width / logo.height;
  ctx.drawImage(logo, 450 - lw / 2, 72, lw, lh);

  // Month title (last word gold when there are several, e.g. RABI SANI).
  const title = model.titleWords.join(' ');
  const ts = fit(ctx, title, s => `700 ${s}px ${SERIF}`, 76, 410, 30);
  ctx.font = `700 ${ts}px ${SERIF}`;
  setSpacing(ctx, 1);
  const total = ctx.measureText(title).width;
  let x = 480 - total / 2;
  ctx.textAlign = 'left';
  model.titleWords.forEach((w, i) => {
    const gold = model.titleWords.length > 1 && i === model.titleWords.length - 1;
    ctx.fillStyle = gold ? GOLD : GREEN;
    ctx.fillText(w, x, 182);
    x += ctx.measureText(`${w} `).width;
  });
  ctx.textAlign = 'center';
  setSpacing(ctx, 0);

  // Arabic month name inside the crescent.
  if (model.arabic) {
    ctx.save();
    ctx.direction = 'rtl';
    const as = fit(ctx, model.arabic, s => `700 ${s}px ${ARABIC}`, 74, 150, 28);
    ctx.font = `700 ${as}px ${ARABIC}`;
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#6b5420'; ctx.fillStyle = '#c9a24d';
    ctx.strokeText(model.arabic, 160, 172);
    ctx.fillText(model.arabic, 160, 172);
    ctx.restore();
  }

  // Year pill and tagline.
  setSpacing(ctx, 3);
  const ps = fit(ctx, model.pill, s => `700 ${s}px ${SERIF}`, 34, 230, 18);
  ctx.font = `700 ${ps}px ${SERIF}`;
  ctx.fillStyle = '#e3c98a';
  ctx.fillText(model.pill, 454, 234);
  setSpacing(ctx, 2.2);
  fit(ctx, model.tagline, s => `${s}px ${SERIF}`, 14, 380, 8);
  ctx.fillStyle = GREEN;
  ctx.fillText(model.tagline, 454, 272);
  setSpacing(ctx, 0);

  // Table header labels.
  ctx.font = `bold 19px ${BODY}`;
  ctx.fillStyle = CREAM_TXT;
  ctx.fillText('Islamic Dates', COL.c1, 634);
  ctx.fillText('MWA Event Date', COL.c2, 634);
  ctx.fillText('Event', COL.c3, 634);

  // Rows.
  let y = ROWS_TOP;
  if (!rows.length) {
    ctx.font = `italic 19px ${BODY}`; ctx.fillStyle = '#6b6b6b';
    ctx.fillText('No events scheduled for this selection.', (COL.x0 + COL.x1) / 2, y + 50);
  }
  for (const r of rows) {
    const mid = y + r.height / 2 + 6;
    drawRich(ctx, hijriSegs(r.hijri), COL.c1, mid, 19, INK);
    drawRich(ctx, gregSegs(r.greg), COL.c2, mid, 19, INK);
    let ey = y + (r.height - (r.blocks.reduce((n, b) => n + b.h, 0) + (r.blocks.length - 1) * 10)) / 2;
    for (const b of r.blocks) {
      ctx.fillStyle = GREEN; ctx.font = `bold 21px ${BODY}`;
      b.titleLines.forEach(l => { ey += 24; ctx.fillText(l, COL.c3, ey - 6); });
      ctx.fillStyle = '#444'; ctx.font = `15px ${BODY}`;
      b.detailLines.forEach(l => { ey += 19; ctx.fillText(l, COL.c3, ey - 5); });
      if (b.department) { ctx.fillStyle = NAVY; ctx.font = `bold 15px ${BODY}`; ey += 20; ctx.fillText(b.department, COL.c3, ey - 6); }
      ey += 10;
    }
    y += r.height;
    ctx.strokeStyle = '#cdb27a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(COL.x0, y); ctx.lineTo(COL.x1, y); ctx.stroke();
  }

  ctx.textAlign = 'right'; ctx.fillStyle = '#333'; ctx.font = `16px ${BODY}`;
  ctx.fillText(model.footerLabel, 832, 1056);
  if (pageCount > 1) { ctx.textAlign = 'left'; ctx.fillText(`Page ${pageNo} of ${pageCount}`, 34, 1056); }
}

export async function renderCalendarPdf(model, filename = 'MWA-Calendar.pdf') {
  const [{ jsPDF }, bg, logo] = await Promise.all([import('jspdf'), loadImage(bgUrl), loadImage(logoUrl), ensureFonts()]);
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  const pages = layoutRows(ctx, model);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pages.forEach((rows, i) => {
    drawPage(ctx, { bg, logo }, model, rows, i + 1, pages.length);
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  });
  pdf.setProperties({ title: `MWA Monthly Calendar – ${model.footerLabel}` });
  pdf.save(filename);
  return pages.length;
}

export function pdfFilename(model) {
  return `MWA-Calendar-${model.footerLabel.replace(/\s*-\s*/g, '-').replace(/[^\w/-]+/g, '-').replace(/\//g, '-')}.pdf`;
}
