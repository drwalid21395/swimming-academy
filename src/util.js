'use strict';
const crypto = require('node:crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escAttr(v) { return esc(v); }

function nl2br(v) {
  return esc(v).replace(/\n/g, '<br>');
}

function fmtDate(iso, withTime) {
  if (!iso) return '—';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return iso;
  const o = { year: 'numeric', month: 'long', day: 'numeric' };
  if (withTime) o.hour = '2-digit', o.minute = '2-digit';
  return d.toLocaleDateString('ar-EG', o);
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('ar-EG');
}

function calcAge(birthDate) {
  if (!birthDate) return '';
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function money(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';
}

function moneyNum(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysUntil(dateStr) {
  const d = new Date(dateStr).getTime();
  const now = new Date().setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function genRef(prefix) {
  const d = new Date();
  return `${prefix}${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${randomDigits(4)}`;
}

function uniq(arr) { return [...new Set(arr)]; }

function parseJSON(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

function slugify(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, '-');
}

module.exports = {
  hashPassword, verifyPassword, esc, escAttr, nl2br, fmtDate, fmtDateShort,
  calcAge, money, moneyNum, today, addDays, daysUntil, genRef, uniq, parseJSON, slugify
};
