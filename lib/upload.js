/** رفع الملفات المشترك (multer) */
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, UPLOAD_DIR); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function removeUploaded(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  try {
    const p = path.join(UPLOAD_DIR, path.basename(publicPath));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) { /* تجاهل */ }
}

module.exports = { upload, UPLOAD_DIR, removeUploaded };
