/* توليد ملفات PDF منسقة (RTL) عبر pdfmake مع خط Tahoma */
const pdfmake = require('pdfmake');

try {
  pdfmake.setFonts({
    Tahoma: {
      normal: 'C:/Windows/Fonts/tahoma.ttf',
      bold: 'C:/Windows/Fonts/tahomabd.ttf',
      italics: 'C:/Windows/Fonts/tahoma.ttf',
      bolditalics: 'C:/Windows/Fonts/tahomabd.ttf'
    }
  });
} catch (e) { console.error('خطأ في تجهيز خطوط PDF:', e.message); }

try { pdfmake.setUrlAccessPolicy(function () { return false; }); } catch (e) {}
try {
  pdfmake.setLocalAccessPolicy(function (filePath) {
    return String(filePath).replace(/\\/g, '/').indexOf('C:/Windows/Fonts/') === 0;
  });
} catch (e) {}

module.exports = pdfmake;
