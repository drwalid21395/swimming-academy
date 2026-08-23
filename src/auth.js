'use strict';
const crypto = require('node:crypto');
const db = require('./db');

const sessions = new Map(); // token -> { userId, createdAt }
const SESSION_TTL = 1000 * 60 * 60 * 12;

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
}

function getUserByUsername(u) {
  return db.prepare('SELECT * FROM users WHERE username=?').get(u);
}

function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const s = getSession(cookies.sid);
  if (!s) return null;
  const user = getUserById(s.userId);
  if (!user || !user.is_active) return null;
  return user;
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  h.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

const roleCache = new Map();
function getPermissions(role) {
  if (roleCache.has(role)) return roleCache.get(role);
  let perms = null;
  try {
    const r = db.prepare('SELECT permissions FROM roles WHERE role=?').get(role);
    if (r && r.permissions) perms = JSON.parse(r.permissions);
  } catch (e) { perms = null; }
  roleCache.set(role, perms);
  return perms;
}

function invalidateRoleCache() { roleCache.clear(); }

function can(user, module, action = 'view') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const perms = getPermissions(user.role);
  if (!perms || !perms[module]) return false;
  return !!perms[module][action];
}

function requireUser(req, res, roleRedirect = '/login') {
  const user = getCurrentUser(req);
  if (!user) {
    res.writeHead(302, { Location: roleRedirect });
    res.end();
    return null;
  }
  return user;
}

function audit(user, action, module, details = '') {
  const ip = '127.0.0.1';
  db.prepare('INSERT INTO audit_log (user_id, username, action, module, details, ip) VALUES (?,?,?,?,?,?)')
    .run(user ? user.id : null, user ? user.username : 'system', action, module, details, ip);
}

module.exports = {
  sessions, createSession, destroySession, getSession, getUserById, getUserByUsername,
  getCurrentUser, parseCookies, can, requireUser, audit, getPermissions, invalidateRoleCache
};
