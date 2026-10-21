/* زر تثبيت التطبيق على الهاتف (PWA) — يعمل في الإدارة والموقع العام وصفحة الدخول */
(function () {
  var deferred = null;
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(msg, type) {
    if (window.App && App.showToast) App.showToast(msg, type || 'success');
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    standalone = true;
    toast('تم تثبيت التطبيق على جهازك', 'success');
  });

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /mac/i.test(navigator.userAgent));
  }

  function ensureCss() {
    if (document.getElementById('installSheetCss')) return;
    var css = document.createElement('style');
    css.id = 'installSheetCss';
    css.textContent =
      '.install-overlay{position:fixed;inset:0;z-index:9999;background:rgba(2,10,20,.6);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .22s ease}' +
      '.install-overlay.show{opacity:1}' +
      '.install-sheet{background:var(--card,#fff);color:var(--text,#0f172a);border-radius:18px;max-width:420px;width:100%;padding:26px 22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35);transform:translateY(14px);transition:transform .22s ease}' +
      '.install-overlay.show .install-sheet{transform:translateY(0)}' +
      '.install-sheet .is-ic{font-size:44px;color:var(--primary,#0ea5e9);margin-bottom:8px}' +
      '.install-sheet h3{margin:0 0 10px;font-size:19px}' +
      '.install-sheet p{margin:0 0 12px;font-size:13.5px;line-height:1.7;color:var(--text-muted,#64748b)}' +
      '.install-sheet ol{text-align:right;margin:0 0 16px;padding-inline-start:22px;font-size:14px;line-height:2.1}' +
      '.install-sheet ol b{color:var(--primary,#0ea5e9)}' +
      '.install-sheet .btn{min-width:120px}';
    document.head.appendChild(css);
  }

  function openSheet(icon, title, body) {
    ensureCss();
    var overlay = document.createElement('div');
    overlay.className = 'install-overlay';
    overlay.innerHTML =
      '<div class="install-sheet" role="dialog" aria-modal="true">' +
      '<div class="is-ic"><i class="fas ' + icon + '"></i></div>' +
      '<h3>' + title + '</h3>' + body +
      '<button type="button" class="btn btn-primary">تمام</button>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() {
      overlay.classList.remove('show');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 260);
    }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('button')) close();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
  }

  function showInstalled() {
    openSheet('fa-circle-check', 'التطبيق مثبت بالفعل', '<p>ستجده على شاشة هاتفك الرئيسية — افتحه من هناك في أي وقت.</p>');
  }

  function showHelp() {
    var ios = isIos();
    var steps = ios
      ? '<p>اتبع الخطوات التالية لإضافته إلى شاشتك الرئيسية:</p><ol><li>افتح زر <b>المشاركة</b> <i class="fas fa-arrow-up-from-bracket"></i> في شريط أدوات سفاري</li><li>مرّر واختر <b>«إضافة إلى الشاشة الرئيسية»</b></li><li>اضغط <b>إضافة</b> في الأعلى</li></ol>'
      : '<p>اتبع الخطوات التالية لتثبيته كتطبيق:</p><ol><li>افتح قائمة المتصفح <b>⋮</b> (أعلى/أسفل الشاشة)</li><li>اختر <b>«تثبيت التطبيق»</b> أو <b>«Install app»</b></li><li>اضغط <b>تثبيت</b> للتأكيد</li></ol>';
    openSheet('fa-mobile-screen-button', 'تثبيت التطبيق على هاتفك', steps);
  }

  function install() {
    if (standalone) { showInstalled(); return; }
    if (deferred) {
      var d = deferred;
      deferred = null;
      d.prompt();
      d.userChoice.then(function (choice) {
        if (choice && choice.outcome !== 'accepted') deferred = d;
      }).catch(function () {});
      return;
    }
    showHelp();
  }

  function bind() {
    all('.install-app-btn').forEach(function (b) {
      if (b.dataset.installBound) return;
      b.dataset.installBound = '1';
      b.addEventListener('click', function (e) { e.preventDefault(); install(); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
