/** رفع الملفات المشترك (multer) — يُخزَّن الملف في قاعدة البيانات */
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { db } = require('./db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!process.env.VERCEL && !fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

/* حفظ الملف المرفوع في جدول file_blobs داخل قاعدة البيانات */
function saveBlobToDb(file) {
  return db.prepare('INSERT OR REPLACE INTO file_blobs (name, mime, size, data) VALUES (?, ?, ?, ?)')
    .run(file.filename, file.mimetype || '', file.size || 0, file.buffer);
}

/* وسيط: يستقبل ملفاً واحداً ثم يحفظه في قاعدة البيانات قبل المتابعة */
function uploadAndStore(fieldName) {
  return function (req, res, next) {
    upload.single(fieldName)(req, res, function (err) {
      if (err) return next(err);
      if (!req.file) return next();
      /* memoryStorage لا يولّد اسماً للملف */
      if (!req.file.filename) {
        const ext = path.extname(req.file.originalname || '').slice(0, 10);
        req.file.filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
      }
      saveBlobToDb(req.file).then(() => next(), next);
    });
  };
}

/* حذف الملف من قاعدة البيانات (ومن القرص إن كان ملفاً قديماً) */
function removeUploaded(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const name = path.basename(publicPath);
  try {
    db.prepare('DELETE FROM file_blobs WHERE name = ?').run(name).catch(() => {});
  } catch (e) { /* تجاهل */ }
  try {
    const p = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) { /* تجاهل */ }
}

/* استرجاع بيانات ملف من قاعدة البيانات */
function getStoredFile(name) {
  return db.prepare('SELECT * FROM file_blobs WHERE name = ?').get(name);
}

module.exports = { upload, uploadAndStore, UPLOAD_DIR, removeUploaded, getStoredFile };
