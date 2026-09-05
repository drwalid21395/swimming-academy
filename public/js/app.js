/* نظام إدارة أكاديمية السباحة - سكربتات الواجهة */
(function () {
  'use strict';

  /* ---------- الوضع الداكن ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('swim-theme', t); } catch (e) { }
    const icon = document.getElementById('themeToggle');
    if (icon) icon.querySelector('i').className = t === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }
  function initTheme() {
    let saved = 'light';
    try { saved = localStorage.getItem('swim-theme') || 'light'; } catch (e) { }
    applyTheme(saved);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('click', function () {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(cur);
    });

    /* ---------- فتح/إغلاق القائمة الجانبية ---------- */
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (menuToggle && sidebar) {
      menuToggle.addEventListener('click', function () {
        if (window.innerWidth <= 768) sidebar.classList.toggle('open');
        else document.body.classList.toggle('sidebar-collapsed');
      });
      if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', function () {
          sidebar.classList.remove('open');
        });
      }
      sidebar.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          if (window.innerWidth <= 768) sidebar.classList.remove('open');
        });
      });
      /* الحفاظ على موضع القائمة الجانبية (التمرير) أثناء التنقل بين الصفحات */
      const SKEY = 'sw-sidebar-scroll';
      var saveScroll = function () {
        try { sessionStorage.setItem(SKEY, String(sidebar.scrollTop)); } catch (e) { }
      };
      var restoreScroll = function () {
        try {
          var v = parseInt(sessionStorage.getItem(SKEY) || '0', 10);
          if (v > 0) sidebar.scrollTop = v;
        } catch (e) { }
      };
      sidebar.addEventListener('scroll', function () {
        clearTimeout(sidebar._st);
        sidebar._st = setTimeout(saveScroll, 150);
      }, { passive: true });
      sidebar.addEventListener('click', function (ev) {
        if (ev.target.closest('a')) saveScroll();
      });
      window.addEventListener('beforeunload', saveScroll);
      restoreScroll();
    }

    /* ---------- قوائم منسدلة ---------- */
    document.querySelectorAll('.dropdown-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const dd = btn.closest('.dropdown');
        const wasOpen = dd.classList.contains('open');
        document.querySelectorAll('.dropdown.open').forEach(function (x) { x.classList.remove('open'); });
        if (!wasOpen) dd.classList.add('open');
      });
    });
    document.addEventListener('click', function () {
      document.querySelectorAll('.dropdown.open').forEach(function (x) { x.classList.remove('open'); });
    });

    /* ---------- تأكيد الحذف (تفويض للعناصر الجديدة أيضاً) ---------- */
    document.addEventListener('click', function (e) {
      const el = e.target.closest('[data-confirm]');
      if (!el) return;
      if (el.tagName === 'FORM') {
        const trigger = e.target.closest('button, a, input[type="submit"]');
        if (!trigger) return;
      }
      e.preventDefault();
      const msg = el.getAttribute('data-confirm') || 'هل أنت متأكد من إتمام هذه العملية؟';
      const action = el.getAttribute('data-action');
      showConfirm(msg, function () {
        if (el.tagName === 'FORM') {
          if (el.hasAttribute('data-ajax')) ajaxMemberRemove(el);
          else el.submit();
        }
        else if (action === 'submit') el.closest('form').submit();
        else if (el.getAttribute('href')) window.location.href = el.getAttribute('href');
      });
    });

    /* ---------- تأكيد إرسال النماذج (اشعار جانبي) ---------- */
    document.addEventListener('submit', function (e) {
      const form = e.target;
      if (form && form.tagName === 'FORM' && form.hasAttribute('data-confirm')) {
        e.preventDefault();
        showConfirm(form.getAttribute('data-confirm'), function () { form.submit(); });
      }
      if (form && form.tagName === 'FORM' && form.hasAttribute('data-ajax-add')) {
        e.preventDefault();
        ajaxMemberAdd(form);
      }
    });

    /* ---------- بحث داخل الجداول ---------- */
    const tableSearch = document.getElementById('tableSearch');
    if (tableSearch) {
      tableSearch.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll('.data-table tbody tr').forEach(function (tr) {
          tr.style.display = tr.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
        });
      });
    }

    /* ---------- فلاتر تحديد (تُدمج الفلاتر النشطة معاً) ---------- */
    var filterSelects = Array.prototype.slice.call(document.querySelectorAll('[data-filter-target]'));
    function applyFilters() {
      const active = filterSelects
        .map(function (s) { return { name: s.getAttribute('data-filter-target'), val: s.value }; })
        .filter(function (f) { return f.val !== ''; });
      document.querySelectorAll('.data-table tbody tr').forEach(function (tr) {
        if (!active.length) { tr.style.display = ''; return; }
        let show = true;
        for (let i = 0; i < active.length; i++) {
          const cell = tr.getAttribute('data-' + active[i].name);
          if (cell === null) { show = false; break; }
          if (cell !== active[i].val) { show = false; break; }
        }
        tr.style.display = show ? '' : 'none';
      });
    }
    filterSelects.forEach(function (sel) {
      sel.addEventListener('change', applyFilters);
    });

    /* ---------- ترتيب الجدول حسب العمود ---------- */
    document.querySelectorAll('.data-table thead th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        const tbody = th.closest('table').querySelector('tbody');
        const idx = Array.prototype.indexOf.call(th.parentNode.children, th);
        const rows = Array.prototype.slice.call(tbody.querySelectorAll('tr')).filter(function (r) {
          return r.cells && r.cells.length > 1;
        });
        if (!rows.length) return;
        const asc = th.classList.contains('sort-asc');
        th.closest('table').querySelectorAll('th.sortable').forEach(function (h) {
          h.classList.remove('sort-asc', 'sort-desc');
          h.querySelector('.sort-ind').textContent = '';
        });
        rows.sort(function (a, b) {
          const av = (a.cells[idx] ? a.cells[idx].textContent.trim() : '');
          const bv = (b.cells[idx] ? b.cells[idx].textContent.trim() : '');
          const an = parseFloat(av.replace(/[^\d.-]/g, ''));
          const bn = parseFloat(bv.replace(/[^\d.-]/g, ''));
          const numeric = av !== '' && bv !== '' && !isNaN(an) && !isNaN(bn);
          let cmp = numeric ? (an - bn) : av.localeCompare(bv, 'ar', { numeric: true, sensitivity: 'base' });
          return asc ? cmp : -cmp;
        });
        rows.forEach(function (r) { tbody.appendChild(r); });
        th.classList.add(asc ? 'sort-desc' : 'sort-asc');
        th.querySelector('.sort-ind').textContent = asc ? '▼' : '▲';
      });
    });

    /* ---------- طباعة ---------- */
    document.querySelectorAll('[data-print]').forEach(function (el) {
      el.addEventListener('click', function () { window.print(); });
    });

    /* ---------- نسبة المستوى المحدد في نموذج السباح ---------- */
    const lvlSelect = document.querySelector('select[name="level_id"]');
    const lpBadge = document.querySelector('.level-percent-badge');
    if (lvlSelect && lpBadge) {
      function refreshLp() {
        const level = lvlSelect.value;
        const swimmer = lpBadge.getAttribute('data-swimmer') || '';
        const val = lpBadge.querySelector('.lp-val');
        if (!level) { val.textContent = '—'; return; }
        fetch('/api/swimmers/level-percent?level_id=' + encodeURIComponent(level) + '&swimmer_id=' + encodeURIComponent(swimmer))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.percent !== null && d.percent !== undefined) val.textContent = 'آخر تقييم: ' + d.percent + '% · عدد المهارات: ' + (d.skills || 0);
            else val.textContent = 'لا يوجد تقييم بعد · عدد المهارات: ' + (d.skills || 0);
          }).catch(function () { val.textContent = '—'; });
      }
      refreshLp();
      lvlSelect.addEventListener('change', refreshLp);
    }

    /* ---------- إغلاق التنبيهات تلقائياً ---------- */
    setTimeout(function () {
      document.querySelectorAll('.toast').forEach(function (t) {
        t.classList.add('hide');
        setTimeout(function () { t.remove(); }, 350);
      });
    }, 4200);

    /* ---------- الحضور التفاعلي ---------- */
    document.querySelectorAll('.att-btn[data-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const wrap = btn.closest('.att-btns');
        const status = btn.getAttribute('data-status');
        const swimmerId = btn.getAttribute('data-swimmer');
        const sessionId = btn.getAttribute('data-session');
        wrap.querySelectorAll('.att-btn[data-status]').forEach(function (b) {
          b.classList.remove('active-present', 'active-absent', 'active-excused', 'active-late');
          const icon = b.querySelector('i');
          if (icon) icon.className = 'fas ' + (b.getAttribute('data-status') === 'present' ? 'fa-check' : b.getAttribute('data-status') === 'absent' ? 'fa-xmark' : b.getAttribute('data-status') === 'excused' ? 'fa-book' : 'fa-clock');
        });
        btn.classList.add('active-' + status);
        if (sessionId && swimmerId) {
          fetch('/attendance/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, swimmer_id: swimmerId, status: status })
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res.ok) showToast('تم حفظ الحضور', 'success');
            else showToast('حدث خطأ في الحفظ', 'error');
          }).catch(function () { showToast('تعذر حفظ الحضور', 'error'); });
        }
      });
    });

    /* ---------- إعداد الحضور للمجموعة بالكامل ---------- */
    document.querySelectorAll('[data-mark-all]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const status = btn.getAttribute('data-mark-all');
        const sessionId = btn.getAttribute('data-session');
        const rows = btn.closest('.att-card').querySelectorAll('.att-row');
        rows.forEach(function (row) {
          const btn2 = row.querySelector('.att-btn[data-status="' + status + '"]');
          if (btn2) btn2.click();
        });
        if (sessionId) {
          fetch('/attendance/mark-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, status: status })
          }).then(function () { });
        }
      });
    });

    /* ---------- عرض تقييم -------- */
    const scorePills = document.querySelectorAll('.score-pill');
    scorePills.forEach(function (p) {
      const v = parseInt(p.textContent, 10);
      if (!isNaN(v)) {
        p.classList.add(v >= 8 ? 'score-high' : v >= 6 ? 'score-mid' : 'score-low');
      }
    });
  });

  /* ---------- التنبيهات ---------- */
  function showToast(msg, type, icon) {
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const container = document.querySelector('.toast-container') || createToastContainer();
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i><span>' + msg + '</span>';
    container.appendChild(t);
    setTimeout(function () { t.classList.add('hide'); setTimeout(function () { t.remove(); }, 350); }, 4000);
  }
  function createToastContainer() {
    const c = document.createElement('div');
    c.className = 'toast-container';
    document.body.appendChild(c);
    return c;
  }

  /* ---------- أدوات أعضاء المجموعة ---------- */
  function gmCard() { return document.querySelector('[data-group-members]'); }
  function gmSelect() { const c = gmCard(); return c ? c.querySelector('select[name="swimmer_id"]') : null; }
  function gmRefresh() {
    const c = gmCard();
    if (!c) return;
    const tbody = c.querySelector('tbody');
    const rows = tbody ? tbody.querySelectorAll('tr').length : 0;
    if (tbody) tbody.querySelectorAll('tr').forEach(function (tr, i) { if (tr.cells[0]) tr.cells[0].textContent = i + 1; });
    const countEl = c.querySelector('[data-member-count]');
    if (countEl) countEl.textContent = rows + ' / ' + (countEl.getAttribute('data-capacity') || '');
    const empty = c.querySelector('[data-empty-members]');
    if (empty) empty.style.display = rows ? 'none' : '';
  }
  function gmPost(form) {
    const params = new URLSearchParams();
    form.querySelectorAll('input[name], select[name]').forEach(function (el) { if (el.name) params.append(el.name, el.value); });
    return fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: params.toString()
    }).then(function (r) { return r.json(); });
  }

  /* ---------- إزالة عضو من المجموعة (بدون إعادة تحميل) ---------- */
  function ajaxMemberRemove(form) {
    gmPost(form).then(function (res) {
      if (!res.ok) { showToast(res.error || 'حدث خطأ', 'error'); return; }
      showToast(res.message, 'success');
      const c = gmCard();
      if (!c) return;
      const tbody = c.querySelector('tbody');
      const sid = String(res.swimmer_id);
      if (tbody) {
        tbody.querySelectorAll('tr').forEach(function (tr) {
          const inp = tr.querySelector('input[name="swimmer_id"]');
          if (inp && String(inp.value) === sid) tr.remove();
        });
      }
      const addSelect = gmSelect();
      if (addSelect && res.removed_name) {
        const opt = document.createElement('option');
        opt.value = sid;
        opt.textContent = res.removed_name + (res.removed_membership ? ' (' + res.removed_membership + ')' : '');
        addSelect.appendChild(opt);
      }
      gmRefresh();
    }).catch(function () { showToast('تعذرت العملية', 'error'); });
  }

  /* ---------- إضافة عضو إلى المجموعة (بدون إعادة تحميل) ---------- */
  function ajaxMemberAdd(form) {
    gmPost(form).then(function (res) {
      if (!res.ok) { showToast(res.error || 'حدث خطأ', 'error'); return; }
      showToast(res.message, 'success');
      const c = gmCard();
      if (c && res.member) {
        const select = gmSelect();
        if (select) {
          Array.prototype.forEach.call(select.options, function (o) {
            if (String(o.value) === String(res.member.id)) o.remove();
          });
          select.value = '';
        }
        const tbody = c.querySelector('tbody');
        if (tbody) {
          const m = res.member;
          const tr = document.createElement('tr');
          const tdIdx = document.createElement('td');
          const tdName = document.createElement('td');
          const b = document.createElement('b');
          b.textContent = m.full_name;
          tdName.appendChild(b);
          const tdM = document.createElement('td');
          tdM.textContent = m.membership_no;
          const tdL = document.createElement('td');
          tdL.textContent = m.level_name || '—';
          const tdA = document.createElement('td');
          tdA.style.textAlign = 'left';
          const form2 = document.createElement('form');
          form2.method = 'POST';
          form2.action = '/groups/' + res.group_id + '/members/remove';
          form2.setAttribute('data-confirm', 'إزالة ' + m.full_name + ' من هذه المجموعة؟');
          form2.setAttribute('data-ajax', '');
          const hid = document.createElement('input');
          hid.type = 'hidden';
          hid.name = 'swimmer_id';
          hid.value = m.id;
          const btn = document.createElement('button');
          btn.type = 'submit';
          btn.className = 'btn btn-ghost btn-sm text-danger';
          btn.textContent = 'إزالة';
          form2.appendChild(hid);
          form2.appendChild(btn);
          tdA.appendChild(form2);
          tr.appendChild(tdIdx);
          tr.appendChild(tdName);
          tr.appendChild(tdM);
          tr.appendChild(tdL);
          tr.appendChild(tdA);
          tbody.appendChild(tr);
        }
        gmRefresh();
      }
    }).catch(function () { showToast('تعذرت العملية', 'error'); });
  }

  /* ---------- اشعار تأكيد جانبي ---------- */
  function showConfirm(message, onOk) {
    const t = document.createElement('div');
    t.className = 'toast toast-confirm';
    t.innerHTML =
      '<div class="confirm-msg"><i class="fas fa-triangle-exclamation"></i><span>' + message + '</span></div>' +
      '<div class="confirm-actions">' +
      '<button type="button" class="btn btn-danger btn-sm" data-ok>تأكيد</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-cancel>تراجع</button>' +
      '</div>';
    const container = document.querySelector('.toast-container') || createToastContainer();
    container.appendChild(t);
    function close() { t.classList.add('hide'); setTimeout(function () { t.remove(); }, 350); }
    t.querySelector('[data-cancel]').addEventListener('click', close);
    t.querySelector('[data-ok]').addEventListener('click', function () { close(); if (onOk) onOk(); });
  }

  window.App = {
    showToast: showToast,
    showConfirm: showConfirm,
    theme: applyTheme
  };
})();
