/** مولّد باركود Code 39 بصيغة SVG (بدون مكتبات خارجية).
    يُستخدم لإظهار كود قابل للمسح لكل مدرب/لاعب داخل شاشة المسح. */
const CHARS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', '-', '.', ' ', '$',
  '/', '+', '%', '*'
];
const ENCODINGS = [
  20957, 29783, 23639, 30485, 20951, 29813, 23669, 20855, 29789, 23645,
  29975, 23831, 30533, 22295, 30149, 24005, 21623, 29981, 23837, 22301,
  30023, 23879, 30545, 22343, 30161, 24017, 21959, 30065, 23921, 22385,
  29015, 18263, 29141, 17879, 29045, 18293, 17783, 29021, 18269, 17477,
  17489, 17681, 20753, 35770
];
const VALID = /^[0-9A-Z\-\.\ $\/\+\%]+$/;

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** سلسلة بتات Code 39: '1' شريط أسود، '0' فراغ — كل خانة وحدة رفيعة */
function bits(text) {
  const value = String(text == null ? '' : text).toUpperCase().trim();
  if (!value || !VALID.test(value)) return '';
  let out = ENCODINGS[CHARS.indexOf('*')].toString(2);
  for (const ch of value) out += ENCODINGS[CHARS.indexOf(ch)].toString(2) + '0';
  out += ENCODINGS[CHARS.indexOf('*')].toString(2);
  return out;
}

function svg(text, options) {
  const opts = options || {};
  const b = bits(text);
  if (!b) return '';
  const unit = Number(opts.unit) || 2;
  const barHeight = Number(opts.height) || 30;
  const pad = opts.pad == null ? 4 : Number(opts.pad);
  const showText = opts.showText !== false;
  const font = Number(opts.font) || 10;
  const textRow = showText ? font + 3 : 0;
  const width = b.length * unit + pad * 2;
  const height = barHeight + textRow + 2;
  let rects = '';
  let x = pad;
  for (const bit of b) {
    if (bit === '1') rects += '<rect x="' + x + '" y="1" width="' + unit + '" height="' + barHeight + '" fill="#101828"/>';
    x += unit;
  }
  const label = showText
    ? '<text x="' + (width / 2) + '" y="' + (barHeight + font + 2) + '" text-anchor="middle" font-family="monospace" font-size="' + font + '" fill="#344054">' + escapeXml(String(text).toUpperCase()) + '</text>'
    : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '" viewBox="0 0 ' + width + ' ' + height + '" style="max-width:100%;height:auto;background:#fff" role="img" aria-label="barcode ' + escapeXml(text) + '">' +
    rects + label + '</svg>';
}

module.exports = { bits, svg };
