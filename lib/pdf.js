/* توليد ملفات PDF منسقة (RTL) عبر pdfmake مع خط عربي متوافق على Windows/Linux */
const pdfmake = require('pdfmake');
const path = require('node:path');

const FONT_DIR = path.join(__dirname, '..', 'public', 'fonts');

try {
  pdfmake.setFonts({
    Tahoma: {
      normal: path.join(FONT_DIR, 'NotoSansArabic-Regular.ttf'),
      bold: path.join(FONT_DIR, 'NotoSansArabic-Bold.ttf'),
      italics: path.join(FONT_DIR, 'NotoSansArabic-Regular.ttf'),
      bolditalics: path.join(FONT_DIR, 'NotoSansArabic-Bold.ttf')
    }
  });
} catch (e) { console.error('خطأ في تجهيز خطوط PDF:', e.message); }

module.exports = pdfmake;
