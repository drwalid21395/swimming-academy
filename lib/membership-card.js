/**
 * بطاقات العضوية: ترميز Code 39 + رسم البطاقة كـ SVG + توليد الباركود PNG وPDF.
 * لا يعتمد على أي مكتبة خارجية غير pdfmake (المشتركة) وzlib المدمجة في Node.
 */
const zlib = require('node:zlib');

/* ---------- Code 39 ----------
   كل حرف = 9 عناصر متبادلة (بار/فراغ) بدءاً ببار، و3 عناصر عريضة.
   1 = عريض (3 وحدات) و0 = رفيع (وحدة واحدة). */
const CODE39 = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001',
  '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100',
  'A': '100001001', 'B': '001001001', 'C': '101001000', 'D': '000011001', 'E': '100011000',
  'F': '001011000', 'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
  'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011', 'O': '100010010',
  'P': '001010010', 'Q': '000000111', 'R': '100000110', 'S': '001000110', 'T': '000010110',
  'U': '110000001', 'V': '011000001', 'W': '111000000', 'X': '010010001', 'Y': '110010000',
  'Z': '011010000', '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100'
};

const VALID = /^[0-9A-Z\-. $/+%]*$/;

function normalizeBarcode(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\*/g, '')
    .replace(/[^0-9A-Za-z\-. $/+%]/g, '')
    .trim()
    .toUpperCase();
}

/* يرجع { text, fullText, bars:[{x,w}], total } بوحدات الموديول */
function code39Modules(text) {
  let clean = normalizeBarcode(text);
  if (!clean) clean = '0';
  if (!VALID.test(clean)) clean = clean.replace(/[^0-9A-Z\-. $/+%]/g, '');
  const fullText = '*' + clean + '*';
  const bars = [];
  let x = 0;
  for (let ci = 0; ci < fullText.length; ci++) {
    const pattern = CODE39[fullText[ci]];
    if (!pattern) continue;
    for (let i = 0; i < 9; i++) {
      const w = pattern[i] === '1' ? 3 : 1;
      if (i % 2 === 0) bars.push({ x: x, w: w }); // عناصر زوجية = بار
      x += w;
    }
    if (ci < fullText.length - 1) x += 1; // فراغ بين الحروف
  }
  return { text: clean, fullText: fullText, bars: bars, total: x };
}

/* ---------- SVG ---------- */
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
  });
}

function barcodeSvg(text, opts) {
  opts = opts || {};
  const moduleWidth = Number(opts.moduleWidth) || 2;
  const height = Number(opts.height) || 70;
  const quiet = opts.quiet == null ? 10 : Number(opts.quiet);
  const color = opts.color || '#0f172a';
  const background = opts.background || '#ffffff';
  const data = code39Modules(text);
  const width = (data.total + quiet * 2) * moduleWidth;
  const x0 = quiet * moduleWidth;
  const rects = data.bars.map(function (b) {
    return '<rect x="' + (x0 + b.x * moduleWidth).toFixed(2) + '" y="0" width="' +
      (b.w * moduleWidth).toFixed(2) + '" height="' + height + '" fill="' + color + '"/>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width.toFixed(2) + '" height="' + height +
    '" viewBox="0 0 ' + width.toFixed(2) + ' ' + height + '" role="img" aria-label="باركود ' + esc(data.text) + '">' +
    '<rect width="100%" height="100%" fill="' + background + '"/>' + rects + '</svg>';
}

function isoDate(value) {
  if (!value) return '';
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : String(value);
}

/* بطاقة العضوية كاملة كـ SVG (أبعاد أفقية مناسبة للطباعة والتحميل كصورة) */
function cardSvg(card, opts) {
  opts = opts || {};
  const W = 1012;
  const H = 638;
  const academy = esc(opts.academyName || 'أكاديمية السباحة');
  const name = esc(card.full_name || '—');
  const program = esc(card.program_name || '—');
  const membership = esc(card.membership_no || '—');
  const birth = esc(isoDate(card.birth_date) || '—');
  const group = esc(card.group_name || '');
  const coach = esc(card.coach_name || '');

  const bc = code39Modules(card.membership_no || '0');
  const bcModule = 2.15;
  const bcHeight = 74;
  const bcQuiet = 8;
  const bcWidth = (bc.total + bcQuiet * 2) * bcModule;
  const bcX = (W - bcWidth) / 2;
  const bcY = 470;
  const bcRects = bc.bars.map(function (b) {
    return '<rect x="' + (bcX + (bcQuiet + b.x) * bcModule).toFixed(2) + '" y="' + bcY +
      '" width="' + (b.w * bcModule).toFixed(2) + '" height="' + bcHeight + '" fill="#0f172a"/>';
  }).join('');

  const infoLine = [group ? ('المجموعة: ' + group) : '', coach ? ('المدرب: ' + coach) : '']
    .filter(Boolean).join('  •  ');

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
    '" id="cardArt" role="img" aria-label="بطاقة عضوية ' + name + '">' +
    '<defs>' +
    '<linearGradient id="mcBg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#062a44"/><stop offset="55%" stop-color="#075985"/><stop offset="100%" stop-color="#0ea5e9"/>' +
    '</linearGradient>' +
    '<linearGradient id="mcSheen" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/><stop offset="45%" stop-color="#ffffff" stop-opacity="0"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="38" fill="url(#mcBg)"/>' +
    '<circle cx="70" cy="30" r="190" fill="#ffffff" opacity="0.055"/>' +
    '<circle cx="930" cy="640" r="240" fill="#000000" opacity="0.10"/>' +
    '<path d="M0 408 C 170 350, 290 470, 470 408 S 760 350, 1012 420 L1012 638 L0 638 Z" fill="#ffffff" opacity="0.05"/>' +
    '<rect x="0" y="0" width="' + W + '" height="190" fill="url(#mcSheen)"/>' +
    '<g font-family="Tahoma, Arial, sans-serif">' +
    /* الترويسة */
    '<text x="' + (W - 58) + '" y="82" text-anchor="end" fill="#ffffff" font-size="34" font-weight="700">' + academy + '</text>' +
    '<text x="' + (W - 58) + '" y="116" text-anchor="end" fill="#bae6fd" font-size="19" letter-spacing="2">CARD MEMBERSHIP</text>' +
    '<g transform="translate(58,54)">' +
    '<rect x="0" y="0" width="188" height="48" rx="24" fill="#ffffff" opacity="0.16"/>' +
    '<text x="94" y="32" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="700">بطاقة عضوية</text>' +
    '</g>' +
    /* أيقونة سباح مختصرة */
    '<g transform="translate(60,150)" opacity="0.85">' +
    '<circle cx="22" cy="18" r="13" fill="#bae6fd"/>' +
    '<path d="M5 55 C 25 38, 40 70, 60 53 C 78 38, 92 63, 106 50" stroke="#7dd3fc" stroke-width="8" fill="none" stroke-linecap="round"/>' +
    '<path d="M0 78 C 28 62, 52 88, 82 74" stroke="#38bdf8" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.7"/>' +
    '</g>' +
    /* بيانات السباح */
    '<text x="' + (W - 58) + '" y="266" text-anchor="end" fill="#ffffff" font-size="56" font-weight="700">' + name + '</text>' +
    '<text x="' + (W - 58) + '" y="316" text-anchor="end" fill="#bae6fd" font-size="25">' + program + '</text>' +
    '<text x="' + (W - 58) + '" y="364" text-anchor="end" fill="#e0f2fe" font-size="21">تاريخ الميلاد: ' + birth + '</text>' +
    (infoLine ? '<text x="' + (W - 58) + '" y="400" text-anchor="end" fill="#e0f2fe" font-size="18" opacity="0.9">' + esc(infoLine) + '</text>' : '') +
    /* رقم العضوية يساراً */
    '<text x="58" y="266" text-anchor="start" fill="#7dd3fc" font-size="16" letter-spacing="1">رقم العضوية</text>' +
    '<text x="58" y="306" text-anchor="start" fill="#ffffff" font-size="32" font-weight="700">' + membership + '</text>' +
    '<text x="58" y="364" text-anchor="start" fill="#bae6fd" font-size="16">امسح الباركود لتسجيل الحضور</text>' +
    /* لوحة الباركود */
    '<rect x="58" y="432" width="' + (W - 116) + '" height="164" rx="20" fill="#ffffff"/>' +
    '<rect x="' + (W - 58 - 150) + '" y="450" width="150" height="27" rx="13" fill="#e0f2fe"/>' +
    '<text x="' + (W - 58 - 75) + '" y="469" text-anchor="middle" fill="#0369a1" font-size="14" font-weight="700">عضوية سارية</text>' +
    bcRects +
    '<text x="' + (W / 2) + '" y="575" text-anchor="middle" fill="#0f172a" font-size="22" font-weight="700" letter-spacing="4">' + membership + '</text>' +
    '</g></svg>';
}

/* ---------- PNG (باركود فقط) ----------
   PNG بسيط بتدرّج رمادي (8-bit grayscale) مبني يدوياً حتى لا نضيف مكتبات. */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    CRC_TABLE[n] = c;
  }
  return CRC_TABLE;
}
function crc32(buf) {
  const table = crcTable();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function barcodePng(text, opts) {
  opts = opts || {};
  const scale = Math.max(1, Number(opts.scale) || 4);
  const height = Math.max(20, Number(opts.height) || 120);
  const quiet = opts.quiet == null ? 10 : Number(opts.quiet);
  const data = code39Modules(text);
  const width = (data.total + quiet * 2) * scale;
  const rowLen = width + 1;
  const row = Buffer.alloc(rowLen);
  row[0] = 0; // filter: none
  row.fill(255, 1);
  data.bars.forEach(function (b) {
    const start = (quiet + b.x) * scale;
    const end = Math.min(width, start + b.w * scale);
    for (let x = start; x < end; x++) row[1 + x] = 0;
  });
  const raw = Buffer.alloc(rowLen * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * rowLen);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
function barcodeDataUrl(text, opts) {
  return 'data:image/png;base64,' + barcodePng(text, opts).toString('base64');
}

/* ---------- PDF ---------- */
/* بطاقة واحدة كـ block داخل مستند pdfmake (تُستخدم للبطاقة المفردة ولتحميل كل البطاقات) */
function cardPdfBlock(card, opts) {
  opts = opts || {};
  const pdfmake = require('./pdf');
  void pdfmake; // الخطوط تُهيَّأ في lib/pdf
  const academy = opts.academyName || 'أكاديمية السباحة';
  const birth = isoDate(card.birth_date) || '—';
  const member = card.membership_no || '—';
  const data = code39Modules(member);
  const scale = 4;
  const quiet = 10;
  const pixelWidth = (data.total + quiet * 2) * scale;
  const pixelHeight = 140;
  const maxWidth = 410;
  const maxHeight = 58;
  let imgW = maxWidth;
  let imgH = imgW * pixelHeight / pixelWidth;
  if (imgH > maxHeight) { imgH = maxHeight; imgW = imgH * pixelWidth / pixelHeight; }
  const barcodeUrl = barcodeDataUrl(member, { scale: scale, height: pixelHeight, quiet: quiet });

  const info = [
    { text: 'البرنامج: ' + (card.program_name || '—'), color: '#e0f2fe', fontSize: 11, margin: [0, 6, 0, 0] },
    {
      columns: [
        { text: 'تاريخ الميلاد: ' + birth, color: '#e0f2fe', fontSize: 10, alignment: 'right', width: '*' },
        { text: 'رقم العضوية: ' + member, color: '#bae6fd', fontSize: 10, alignment: 'left', width: '*', bold: true }
      ],
      margin: [0, 4, 0, 0]
    }
  ];
  if (card.group_name || card.coach_name) {
    const parts = [];
    if (card.group_name) parts.push('المجموعة: ' + card.group_name);
    if (card.coach_name) parts.push('المدرب: ' + card.coach_name);
    info.push({ text: parts.join('  •  '), color: '#bae6fd', fontSize: 9, margin: [0, 4, 0, 0] });
  }

  const cardBody = {
    stack: [
      {
        columns: [
          { text: academy, color: '#ffffff', fontSize: 13, bold: true, alignment: 'right', width: '*' },
          { text: 'بطاقة عضوية', color: '#7dd3fc', fontSize: 11, bold: true, alignment: 'left', width: 'auto' }
        ]
      },
      { text: card.full_name || '—', color: '#ffffff', fontSize: 24, bold: true, alignment: 'right', margin: [0, 12, 0, 2] },
      info,
      {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { image: barcodeUrl, width: imgW, height: imgH, alignment: 'center' },
              { text: member, color: '#0f172a', fontSize: 11, bold: true, alignment: 'center', margin: [0, 5, 0, 0] }
            ],
            fillColor: '#ffffff',
            margin: [12, 10, 12, 8],
            border: [false, false, false, false]
          }]]
        },
        layout: 'noBorders',
        margin: [0, 14, 0, 0]
      }
    ],
    fillColor: '#075985',
    margin: [22, 18, 22, 18],
    border: [false, false, false, false]
  };

  return {
    table: { widths: [470], body: [[cardBody]] },
    layout: 'noBorders',
    alignment: 'center'
  };
}

function cardPdfDoc(card, opts) {
  return {
    pageSize: 'A4',
    pageMargins: [42, 42, 42, 42],
    defaultStyle: { font: 'Tahoma', alignment: 'right', color: '#0f172a' },
    content: [
      { text: 'بطاقة عضوية سباح', alignment: 'center', fontSize: 15, bold: true, color: '#0369a1', margin: [0, 0, 0, 14] },
      cardPdfBlock(card, opts),
      { text: 'امسح الباركود عند بوابة الدخول لتسجيل الحضور — البطاقة صالحة لعضو واحد فقط.', alignment: 'center', fontSize: 8, color: '#64748b', margin: [0, 16, 0, 0] }
    ]
  };
}

/* مستند واحد يضم جميع البطاقات: بطاقة في كل صفحة، جاهز للطباعة دفعة واحدة */
function cardsPdfDoc(cards, opts) {
  const list = Array.isArray(cards) ? cards : [];
  const content = [];
  list.forEach(function (card, i) {
    const node = {
      stack: [
        { text: 'بطاقة ' + (i + 1) + ' من ' + list.length, alignment: 'center', fontSize: 9, color: '#64748b', margin: [0, 0, 0, 10] },
        cardPdfBlock(card, opts)
      ]
    };
    if (i > 0) node.pageBreak = 'before';
    content.push(node);
  });
  if (!content.length) content.push({ text: 'لا توجد بطاقات عضوية للتحميل.', alignment: 'center', color: '#64748b', margin: [0, 40, 0, 0] });
  return {
    pageSize: 'A4',
    pageMargins: [42, 42, 42, 42],
    defaultStyle: { font: 'Tahoma', alignment: 'right', color: '#0f172a' },
    content: content
  };
}

module.exports = {
  CODE39,
  normalizeBarcode,
  code39Modules,
  barcodeSvg,
  barcodePng,
  barcodeDataUrl,
  cardSvg,
  cardPdfBlock,
  cardPdfDoc,
  cardsPdfDoc,
  isoDate
};
