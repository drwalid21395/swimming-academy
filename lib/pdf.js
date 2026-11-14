/* توليد ملفات PDF منسقة (RTL) عبر pdfmake مع خط عربي متوافق على Windows/Linux */
const pdfmake = require('pdfmake');
const path = require('node:path');

const FONT_DIR = path.join(__dirname, '..', 'public', 'fonts');

try {
  const fonts = {
    normal: path.join(FONT_DIR, 'Amiri-Regular.ttf'),
    bold: path.join(FONT_DIR, 'Amiri-Bold.ttf'),
    italics: path.join(FONT_DIR, 'Amiri-Regular.ttf'),
    bolditalics: path.join(FONT_DIR, 'Amiri-Bold.ttf')
  };
  pdfmake.setFonts({
    Tahoma: fonts,
    Amiri: fonts
  });
} catch (e) { console.error('خطأ في تجهيز خطوط PDF:', e.message); }

module.exports = pdfmake;
