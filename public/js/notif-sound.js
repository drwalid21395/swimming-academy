/* صوت إشعارات النشاط: تحديث دوري خفيف + نغمات WebAudio + تنبيهات منبثقة
   لا يعتمد على ملفات صوتية، ويحترم صلاحية «استقبال صوت إشعارات النشاط». */
(function () {
  'use strict';

  var cfg = window.SW_NOTIF_CFG || null;
  if (!cfg || !cfg.userId) return;

  var STORE_KEY = 'sw-notif-last-v1-' + cfg.userId;
  var lastId = 0;
  try { lastId = Number(localStorage.getItem(STORE_KEY) || 0) || 0; } catch (e) { lastId = 0; }
  var firstPoll = true;
  var busy = false;
  var timer = null;
  var audioCtx = null;

  var SOUND_TYPES = ['chime', 'bell', 'ping', 'beep', 'alarm'];

  /* ---------- الصوت ---------- */
  function ensureCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) {
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') {
      try { audioCtx.resume(); } catch (e) { /* تجاهل */ }
    }
    return audioCtx;
  }

  function note(freq, delay, duration, wave, peak) {
    var ctx = ensureCtx();
    if (!ctx) return;
    var t0 = ctx.currentTime + delay;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = wave || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.06);
  }

  function playSound(type, volume) {
    var vol = Number(volume);
    if (!isFinite(vol)) vol = 70;
    vol = Math.max(0, Math.min(100, vol));
    if (vol <= 0) return;
    var master = 0.28 * (vol / 100);
    type = SOUND_TYPES.indexOf(type) > -1 ? type : 'chime';
    if (type === 'chime') {
      note(880.00, 0.00, 0.34, 'sine', master * 0.75);
      note(1174.66, 0.17, 0.34, 'sine', master * 0.7);
      note(1567.98, 0.34, 0.45, 'sine', master * 0.65);
    } else if (type === 'bell') {
      note(1046.50, 0.00, 0.9, 'sine', master * 0.7);
      note(2093.00, 0.01, 0.5, 'sine', master * 0.22);
      note(1046.50, 0.42, 0.9, 'sine', master * 0.55);
      note(2093.00, 0.43, 0.5, 'sine', master * 0.18);
    } else if (type === 'ping') {
      note(1567.98, 0.00, 0.22, 'sine', master);
      note(2093.00, 0.09, 0.3, 'sine', master * 0.7);
    } else if (type === 'beep') {
      note(880.00, 0.00, 0.13, 'square', master * 0.35);
      note(880.00, 0.2, 0.13, 'square', master * 0.35);
    } else if (type === 'alarm') {
      note(988.00, 0.00, 0.14, 'square', master * 0.35);
      note(740.00, 0.18, 0.14, 'square', master * 0.35);
      note(988.00, 0.36, 0.14, 'square', master * 0.35);
      note(740.00, 0.54, 0.18, 'square', master * 0.35);
    }
    if (navigator.vibrate) {
      try { navigator.vibrate([120, 70, 120]); } catch (e) { /* تجاهل */ }
    }
  }

  /* بعض المتصفحات تمنع الصوت قبل تفاعل المستخدم: نفكّ القفل عند أول لمسة */
  function unlockOnGesture() {
    ensureCtx();
    document.removeEventListener('pointerdown', unlockOnGesture, true);
    document.removeEventListener('keydown', unlockOnGesture, true);
    document.removeEventListener('touchstart', unlockOnGesture, true);
  }
  document.addEventListener('pointerdown', unlockOnGesture, true);
  document.addEventListener('keydown', unlockOnGesture, true);
  document.addEventListener('touchstart', unlockOnGesture, true);

  /* ---------- الشارة والتنبيهات ---------- */
  function updateBadge(count) {
    var bell = document.getElementById('notifBell');
    if (!bell) return;
    var dot = bell.querySelector('.dot');
    count = Number(count) || 0;
    if (count > 0) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'dot';
        bell.appendChild(dot);
      }
      dot.style.display = 'flex';
      dot.textContent = count > 99 ? '99+' : String(count);
    } else if (dot) {
      dot.style.display = 'none';
      dot.textContent = '';
    }
  }

  function toastContainer() {
    var c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  function showUpdateToast(title, message, link) {
    var c = toastContainer();
    var t = document.createElement('div');
    t.className = 'toast info';
    t.style.cursor = 'pointer';
    var icon = document.createElement('i');
    icon.className = 'fas fa-bell';
    var span = document.createElement('span');
    var text = String(title || 'تحديث جديد');
    if (message) text += ' — ' + String(message);
    if (text.length > 180) text = text.slice(0, 177) + '…';
    span.textContent = text;
    t.appendChild(icon);
    t.appendChild(span);
    t.addEventListener('click', function () { window.location.href = link || '/notifications'; });
    c.appendChild(t);
    setTimeout(function () {
      t.classList.add('hide');
      setTimeout(function () { t.remove(); }, 350);
    }, 6500);
  }

  function deviceNotification(item) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg && reg.showNotification) {
            reg.showNotification(String(item.title || 'تحديث جديد'), {
              body: String(item.message || '').slice(0, 180),
              icon: '/images/icon-192.png',
              badge: '/images/icon-192.png',
              data: { url: item.link || '/notifications' }
            });
          }
        }).catch(function () {});
      }
    } catch (e) { /* تجاهل */ }
  }

  function handleItems(items) {
    if (!items || !items.length) return;
    var enabled = cfg.enabled !== false;
    if (enabled) playSound(cfg.sound, cfg.volume);
    var latest = items[items.length - 1];
    if (items.length === 1) {
      showUpdateToast(latest.title, latest.message, latest.link);
    } else {
      showUpdateToast('لديك ' + items.length + ' تحديثات جديدة', latest.title, latest.link || '/notifications');
    }
    deviceNotification(latest);
  }

  /* ---------- التحديث الدوري ---------- */
  function storeLast(id) {
    lastId = Math.max(lastId, Number(id) || 0);
    try { localStorage.setItem(STORE_KEY, String(lastId)); } catch (e) { /* تجاهل */ }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    var secs = Number(cfg.pollSeconds) || 20;
    secs = Math.max(5, Math.min(120, secs));
    timer = setTimeout(poll, secs * 1000);
  }

  function applyConfig(data) {
    if (!data) return;
    if (typeof data.receive !== 'undefined') cfg.receive = !!data.receive;
    if (typeof data.enabled !== 'undefined') cfg.enabled = !!data.enabled;
    if (typeof data.volume !== 'undefined') cfg.volume = Number(data.volume);
    if (data.sound && SOUND_TYPES.indexOf(data.sound) > -1) cfg.sound = data.sound;
    if (typeof data.pollSeconds !== 'undefined') cfg.pollSeconds = Number(data.pollSeconds);
  }

  function poll() {
    if (busy) return;
    if (navigator.onLine === false) { schedule(); return; }
    busy = true;
    var storedBefore = lastId;
    fetch('/api/notifications/poll?after=' + encodeURIComponent(String(lastId)), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (!data || !data.ok) return;
      applyConfig(data);
      updateBadge(data.unread);
      if (!data.receive) return;
      if (firstPoll && storedBefore <= 0) {
        /* أول زيارة: خزّن آخر معرّف بهدوء دون رنين لإشعارات قديمة */
        storeLast(data.latestId);
        return;
      }
      var items = data.items || [];
      if (items.length) {
        storeLast(data.latestId || items[items.length - 1].id);
        handleItems(items);
      } else {
        storeLast(data.latestId);
      }
    }).catch(function () {
      /* تجاهل أخطاء الشبكة المؤقتة */
    }).then(function () {
      busy = false;
      firstPoll = false;
      schedule();
    });
  }

  function pollNow() {
    if (timer) clearTimeout(timer);
    poll();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) pollNow();
  });
  window.addEventListener('online', pollNow);
  window.addEventListener('pageshow', function (e) {
    if (e && e.persisted) pollNow();
  });

  /* ---------- Web Push (إشعارات الهاتف/سطح المكتب) ---------- */
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { ok: false, error: 'المتصفح لا يدعم PushManager' };
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!reg) return { ok: false, error: 'Service Worker لم يُجهّز' };
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const res = await fetch('/api/notifications/vapid-public-key', { cache: 'no-store', credentials: 'same-origin' });
        const data = await res.json();
        if (!data || !data.ok || !data.key) {
          return { ok: false, error: 'لم يتم الحصول على مفتاح VAPID (' + (data ? data.error : 'no response') + ')' };
        }
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.key) });
      }
      const saveRes = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(sub.toJSON())
      });
      const saveData = await saveRes.json();
      if (!saveData || !saveData.ok) {
        return { ok: false, error: 'فشل حفظ الاشتراك في الخادم (' + (saveData && saveData.error ? saveData.error : saveRes.status) + ')' };
      }
      return { ok: true };
    } catch (e) {
      console.error('SWNotif: خطأ في الاشتراك', e);
      return { ok: false, error: e && e.message ? e.message : 'خطأ غير معروف' };
    }
  }

  /* إذا كان الإذن ممنوحاً مسبقاً، نتأكد من تسجيل الاشتراك لدى الخادم */
  if ('Notification' in window && Notification.permission === 'granted') {
    subscribePush().catch(function () {});
  }

  /* واجهة للاختبار من صفحة الإعدادات */
  window.SWNotif = {
    test: function (type, volume) { playSound(type, volume); },
    unlock: ensureCtx,
    requestPermission: function (cb) {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (cb) cb('unsupported');
        return;
      }
      var isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
      var isStandalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (isIos && !isStandalone) {
        if (cb) cb('unsupported: يجب تثبيت التطبيق على الشاشة الرئيسية أولاً (Add to Home Screen)');
        return;
      }
      try {
        Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') { if (cb) cb(perm); return; }
          subscribePush().then(function (result) {
            if (cb) cb(result.ok ? 'granted' : 'error: ' + (result.error || 'unknown'));
          }).catch(function (e) { if (cb) cb('error: ' + (e && e.message ? e.message : 'exception')); });
        }).catch(function () { if (cb) cb('denied'); });
      } catch (e) { if (cb) cb('error: ' + (e && e.message ? e.message : 'exception')); }
    }
  };

  poll();
})();
