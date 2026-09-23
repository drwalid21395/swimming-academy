const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const storage = new AsyncLocalStorage();
const enabled = process.env.PERF_LOG === '1' || process.env.NODE_ENV === 'development';

function recordQuery(sql, duration) {
  const state = storage.getStore();
  if (!state) return;
  state.queries += 1;
  state.dbMs += duration;
  if (duration >= 100) state.slowQueries.push({ ms: Math.round(duration), operation: String(sql).trim().slice(0, 100) });
}

function measure(sql, operation) {
  const started = performance.now();
  return { started, sql, operation };
}

function finish(measurement) {
  recordQuery(measurement.sql, performance.now() - measurement.started);
}

function middleware(req, res, next) {
  if (!enabled) return next();
  const state = { started: performance.now(), queries: 0, dbMs: 0, slowQueries: [] };
  storage.run(state, () => {
    res.on('finish', () => {
      const total = Math.round(performance.now() - state.started);
      if (total >= 250 || state.slowQueries.length) {
        console.info('[perf]', req.method, req.originalUrl, JSON.stringify({ ms: total, dbMs: Math.round(state.dbMs), queries: state.queries, slow: state.slowQueries }));
      }
    });
    next();
  });
}

module.exports = { middleware, measure, finish };
