/* ayanami.vault — vault.js
   Loads and renders all widgets, handles add/edit/delete,
   encrypts/decrypts data client-side via crypto.js.
*/

// ─── State ─────────────────────────────────────────────────────────────────
let vaultKey    = null;   // CryptoKey derived after unlock
let allWidgets  = [];
let activeFilter = 'all';
let editingId    = null;  // widget id being edited (null = new)
let deleteTarget = null;

const csrf = () => document.querySelector('meta[name="csrf-token"]').content;

// ─── Boot ─────────────────────────────────────────────────────────────────
(async function boot() {
  // Ask for vault key via in-page prompt (session is already unlocked server-side,
  // so the key was already verified. We just need it in memory for decryption.)
  vaultKey = await promptForKey();
  if (!vaultKey) return;
  await loadWidgets();
})();

// ─── Key prompt ────────────────────────────────────────────────────────────
function promptForKey() {
  return new Promise(resolve => {
    // Build a minimal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">enter vault key</h3>
        </div>
        <div class="modal-fields">
          <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem">
            Re-enter your vault key to decrypt your data in this tab.
            It stays in browser memory only.
          </p>
          <div class="field">
            <label class="field-label" for="inPageKey">vault key</label>
            <div class="field-wrap">
              <input class="field-input" type="password" id="inPageKey" autofocus autocomplete="current-password" />
              <button type="button" class="field-eye" data-eye="inPageKey">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>
          <div id="inPageKeyErr" class="form-msg form-msg--error" style="display:none"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn--primary btn--sm" id="inPageKeySubmit">unlock</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    setupEyeToggle(overlay);

    const input  = overlay.querySelector('#inPageKey');
    const submit = overlay.querySelector('#inPageKeySubmit');
    const err    = overlay.querySelector('#inPageKeyErr');

    async function attempt() {
      const pw = input.value;
      if (!pw) return;
      submit.disabled = true;
      submit.textContent = 'unlocking…';
      err.style.display = 'none';

      try {
        // Fetch salt + test blob from server
        const info = await apiFetch('/api/vault-info');
        const key  = await vault_deriveKey(pw, info.vault_salt);
        // Verify by decrypting the sentinel
        const sentinel = await vault_decrypt(key, info.vault_test, info.vault_test_iv);
        if (sentinel !== 'ayanami.vault.ok') throw new Error('wrong key');
        overlay.remove();
        resolve(key);
      } catch {
        err.textContent   = 'Incorrect vault key.';
        err.style.display = 'block';
        submit.disabled   = false;
        submit.textContent = 'unlock';
        input.focus();
      }
    }

    submit.addEventListener('click', attempt);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  });
}

// ─── Load + render all widgets ────────────────────────────────────────────
async function loadWidgets() {
  const grid = document.getElementById('widgetGrid');
  const { widgets } = await apiFetch('/api/widgets');

  // Decrypt each widget payload
  const decrypted = await Promise.all(widgets.map(async w => {
    try {
      const json = await vault_decrypt(vaultKey, w.data_enc, w.data_iv);
      return { ...w, data: JSON.parse(json) };
    } catch {
      return { ...w, data: null, _decryptError: true };
    }
  }));

  allWidgets = decrypted;
  renderGrid();
}

// ─── Render ────────────────────────────────────────────────────────────────
function renderGrid() {
  const grid   = document.getElementById('widgetGrid');
  const empty  = document.getElementById('vaultEmpty');
  const count  = document.getElementById('widgetCount');
  const search = document.getElementById('widgetSearch').value.toLowerCase();

  let filtered = allWidgets.filter(w => {
    if (activeFilter !== 'all' && w.type !== activeFilter) return false;
    if (!search) return true;
    const title = (w.title || '').toLowerCase();
    const body  = JSON.stringify(w.data || '').toLowerCase();
    return title.includes(search) || body.includes(search);
  });

  grid.innerHTML = '';

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    count.textContent   = '';
    return;
  }
  empty.style.display = 'none';
  count.textContent   = filtered.length;

  filtered.forEach(w => grid.appendChild(buildWidgetEl(w)));
}

// Extract a usable URL from a widget's decrypted data (bookmark or account)
function widgetUrl(w) {
  if (!w.data) return null;
  const raw = w.data.url || '';
  if (!raw) return null;
  try { return new URL(raw).hostname ? raw : null; } catch { return null; }
}

function faviconImg(url) {
  try {
    const host = new URL(url).hostname;
    return `<img class="widget-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=16" alt="" width="14" height="14" />`;
  } catch { return ''; }
}

function widgetBadgeIcon(w) {
  if (w.data?.icon_url) {
    return `<img class="widget-favicon" src="${esc(w.data.icon_url)}" alt="" width="14" height="14" />`;
  }
  const url = widgetUrl(w);
  return url ? faviconImg(url) : '';
}

function buildWidgetEl(w) {
  const el = document.createElement('div');
  el.className = 'widget' + (w.pinned ? ' widget--pinned' : '');
  el.dataset.id = w.id;

  const badge = widgetBadgeIcon(w);

  const typeMeta = {
    note:     { label: 'note',     icon: noteIcon() },
    reminder: { label: 'reminder', icon: reminderIcon() },
    bookmark: { label: 'bookmark', icon: badge || bookmarkIcon() },
    account:  { label: 'account',  icon: badge || accountIcon() },
    birthday: { label: 'birthday', icon: birthdayIcon() },
  };
  const meta = typeMeta[w.type] || { label: w.type, icon: '' };

  el.innerHTML = `
    <div class="widget-header">
      <div>
        <div class="widget-type-badge">${meta.icon}${meta.label}</div>
        <div class="widget-title">${esc(w.title || 'Untitled')}</div>
      </div>
      <div class="widget-actions">
        <button class="widget-action-btn widget-action-btn--pin${w.pinned ? ' is-pinned' : ''}"
                title="${w.pinned ? 'unpin' : 'pin'}" data-action="pin" data-id="${w.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${w.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
        <button class="widget-action-btn" title="edit" data-action="edit" data-id="${w.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="widget-action-btn widget-action-btn--del" title="delete" data-action="delete" data-id="${w.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
    <div class="widget-body">${renderWidgetBody(w)}</div>
    ${renderTags(w.tags)}`;

  // Action buttons
  el.querySelector('[data-action="edit"]').addEventListener('click',   () => openEdit(w.id));
  el.querySelector('[data-action="delete"]').addEventListener('click', () => openDelete(w.id));
  el.querySelector('[data-action="pin"]').addEventListener('click',    () => togglePin(w.id));

  // Copy buttons added inside body
  el.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(() => toast('copied', 'ok'));
    });
  });

  // Password reveal
  el.querySelectorAll('[data-reveal-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = el.querySelector('[data-password-field]');
      if (!target) return;
      const hidden = target.textContent === '••••••••';
      target.textContent = hidden ? btn.dataset.revealPassword : '••••••••';
    });
  });

  return el;
}

function renderWidgetBody(w) {
  if (w._decryptError) return `<span style="color:var(--danger);font-size:.75rem">⚠ decryption failed</span>`;
  if (!w.data) return '';

  switch (w.type) {
    case 'note':
      return `<div class="widget-note-content">${esc(w.data.content || '')}</div>`;

    case 'reminder': {
      const done     = !!w.data.completed;
      const dueDate  = w.data.due_date ? new Date(w.data.due_date) : null;
      const overdue  = dueDate && !done && dueDate < new Date();
      return `<div class="${done ? 'widget-reminder-done' : ''}">
        <div style="font-size:.82rem;color:var(--text-muted)">${esc(w.data.content || '')}</div>
        ${dueDate ? `<div class="widget-reminder-date${overdue ? ' widget-reminder-date--overdue' : ''}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${overdue ? 'overdue · ' : ''}${dueDate.toLocaleDateString()}
        </div>` : ''}
      </div>`;
    }

    case 'bookmark':
      return `<div style="font-size:.8rem;color:var(--text-muted)">${esc(w.data.description || '')}</div>
        ${w.data.url ? `<a class="widget-url" href="${esc(w.data.url)}" target="_blank" rel="noopener noreferrer">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          ${esc(w.data.url)}
        </a>` : ''}`;

    case 'account': {
      const rows = [
        w.data.username ? ['username', w.data.username] : null,
        w.data.email    ? ['email',    w.data.email]    : null,
        w.data.url      ? ['url',      w.data.url]      : null,
      ].filter(Boolean);
      const passRow = w.data.password ? `
        <div class="widget-account-row">
          <span class="widget-account-key">password</span>
          <div class="widget-password-wrap">
            <span class="widget-account-val" data-password-field>••••••••</span>
            <button class="widget-password-reveal" data-reveal-password data-reveal-password="${esc(w.data.password)}" title="reveal">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="widget-copy-btn" data-copy="${esc(w.data.password)}" title="copy password">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </div>` : '';

      return rows.map(([k, v]) => `
        <div class="widget-account-row">
          <span class="widget-account-key">${esc(k)}</span>
          <span class="widget-account-val">${esc(v)}</span>
          <button class="widget-copy-btn" data-copy="${esc(v)}" title="copy ${esc(k)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>`).join('') + passRow +
        (w.data.notes ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:.5rem">${esc(w.data.notes)}</div>` : '');
    }

    case 'birthday': {
      if (!w.data.date) return '';
      const bday  = new Date(w.data.date + 'T00:00:00');
      const today = new Date();
      let age     = today.getFullYear() - bday.getFullYear();
      const next  = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      const daysUntil = Math.round((next - today) / (1000 * 60 * 60 * 24));
      const upcoming  = daysUntil <= 14;

      return `<div class="widget-birthday-date">${bday.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</div>
        <div class="widget-birthday-age">${age} years old</div>
        ${upcoming ? `<div class="widget-birthday-upcoming">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${daysUntil === 0 ? 'today!' : daysUntil + ' days away'}
        </div>` : ''}`;
    }

    default:
      return '';
  }
}

function renderTags(tagsStr) {
  let tags = [];
  try { tags = JSON.parse(tagsStr || '[]'); } catch {}
  if (!tags.length) return '';
  return `<div class="widget-tags">${tags.map(t => `<span class="widget-tag">${esc(t)}</span>`).join('')}</div>`;
}

// ─── Filter sidebar ───────────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('filter-btn--active'));
    btn.classList.add('filter-btn--active');
    activeFilter = btn.dataset.filter;
    document.getElementById('filterLabel').textContent =
      activeFilter === 'all' ? 'all items' : activeFilter + 's';
    renderGrid();
  });
});

document.getElementById('widgetSearch').addEventListener('input', renderGrid);

// ─── Add widget ───────────────────────────────────────────────────────────
document.getElementById('addWidgetBtn').addEventListener('click',      () => openModal(null));
document.getElementById('addWidgetBtnEmpty').addEventListener('click', () => openModal(null));

// ─── Modal logic ──────────────────────────────────────────────────────────
function openModal(widgetId) {
  editingId = widgetId;
  const modal     = document.getElementById('widgetModal');
  const title     = document.getElementById('modalTitle');
  const typePicker = document.getElementById('typePicker');
  const form      = document.getElementById('widgetForm');
  const errEl     = document.getElementById('modalError');

  errEl.style.display  = 'none';
  form.style.display   = 'none';

  if (widgetId) {
    const w = allWidgets.find(x => x.id === widgetId);
    if (!w) return;
    title.textContent    = 'edit item';
    typePicker.style.display = 'none';
    form.style.display   = 'block';
    buildModalForm(w.type, w);
  } else {
    title.textContent    = 'add item';
    typePicker.style.display = 'grid';
    buildTypePickerHandlers();
  }

  modal.style.display = 'flex';
  modal.focus();
}

function buildTypePickerHandlers() {
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('typePicker').style.display  = 'none';
      document.getElementById('widgetForm').style.display  = 'block';
      buildModalForm(btn.dataset.type, null);
    };
  });
}

function buildModalForm(type, existing) {
  const fields  = document.getElementById('modalFields');
  const saveBtn = document.getElementById('modalSave');
  fields.innerHTML = '';

  const data = existing?.data || {};

  // Title field (all types)
  fields.appendChild(makeField('title', 'Title', 'text', existing?.title || '', 'e.g. Google account', false, true));

  switch (type) {
    case 'note':
      fields.appendChild(makeTextarea('content', 'Note', data.content || '', 'Write your note…'));
      break;

    case 'reminder':
      fields.appendChild(makeTextarea('content', 'Reminder', data.content || '', 'What do you need to do?'));
      fields.appendChild(makeField('due_date', 'Due date', 'datetime-local', data.due_date ? data.due_date.slice(0,16) : '', '', false, false));
      fields.appendChild(makeCheckbox('completed', 'Mark as done', !!data.completed));
      break;

    case 'bookmark':
      fields.appendChild(makeField('url', 'URL', 'url', data.url || '', 'https://…', false, false));
      fields.appendChild(makeTextarea('description', 'Description', data.description || '', 'What is this link?'));
      break;

    case 'account':
      fields.appendChild(makeIconUploadField('icon_url', 'Icon', data.icon_url || ''));
      fields.appendChild(makeField('username', 'Username', 'text', data.username || '', '', false, false));
      fields.appendChild(makeField('email', 'Email', 'email', data.email || '', '', false, false));
      fields.appendChild(makePasswordField('password', 'Password', data.password || ''));
      fields.appendChild(makeField('url', 'Website URL', 'url', data.url || '', 'https://…', false, false));
      fields.appendChild(makeTextarea('notes', 'Notes', data.notes || '', 'Optional notes…'));
      break;

    case 'birthday':
      fields.appendChild(makeField('name_full', 'Full name', 'text', data.name_full || '', '', false, false));
      fields.appendChild(makeField('date', 'Date of birth', 'date', data.date || '', '', false, false));
      fields.appendChild(makeTextarea('notes', 'Notes', data.notes || '', 'Optional…'));
      break;
  }

  fields.appendChild(makeTagsField(existing?.tags));

  saveBtn.onclick = () => saveWidget(type, existing?.id || null);
}

// ─── Save widget ──────────────────────────────────────────────────────────
async function saveWidget(type, id) {
  const fields  = document.getElementById('modalFields');
  const errEl   = document.getElementById('modalError');
  const saveBtn = document.getElementById('modalSave');

  errEl.style.display    = 'none';
  saveBtn.disabled       = true;
  saveBtn.textContent    = 'saving…';

  try {
    const title = fields.querySelector('[name="title"]')?.value.trim() || '';
    const payload = collectPayload(type, fields);
    const tags    = collectTags(fields);

    const { data, iv } = await vault_encrypt(vaultKey, JSON.stringify(payload));

    const body = { type, title, data_enc: data, data_iv: iv, tags };

    let result;
    if (id) {
      result = await apiFetch(`/api/widgets/${id}`, 'PUT', body);
    } else {
      result = await apiFetch('/api/widgets', 'POST', body);
    }

    // Update local state
    if (id) {
      const idx = allWidgets.findIndex(w => w.id === id);
      if (idx !== -1) allWidgets[idx] = { ...allWidgets[idx], ...result.widget, data: payload };
    } else {
      allWidgets.unshift({ ...result.widget, data: payload });
    }

    closeModal();
    renderGrid();
    toast(id ? 'saved' : 'added', 'ok');
  } catch (err) {
    errEl.textContent   = err.message || 'Failed to save.';
    errEl.style.display = 'block';
    saveBtn.disabled    = false;
    saveBtn.textContent = 'save';
  }
}

function collectPayload(type, fields) {
  const get = name => fields.querySelector(`[name="${name}"]`)?.value.trim() || '';
  const getChecked = name => !!(fields.querySelector(`[name="${name}"]`)?.checked);
  switch (type) {
    case 'note':     return { content: get('content') };
    case 'reminder': return { content: get('content'), due_date: get('due_date'), completed: getChecked('completed') };
    case 'bookmark': return { url: get('url'), description: get('description') };
    case 'account':  return { icon_url: get('icon_url'), username: get('username'), email: get('email'), password: get('password'), url: get('url'), notes: get('notes') };
    case 'birthday': return { name_full: get('name_full'), date: get('date'), notes: get('notes') };
    default:         return {};
  }
}

function collectTags(fields) {
  const wrap = fields.querySelector('.tags-input-wrap');
  if (!wrap) return [];
  return [...wrap.querySelectorAll('.tags-input-tag[data-tag]')].map(el => el.dataset.tag);
}

// ─── Edit / pin / delete ──────────────────────────────────────────────────
function openEdit(id) {
  openModal(id);
}

async function togglePin(id) {
  const w = allWidgets.find(x => x.id === id);
  if (!w) return;
  const pinned = !w.pinned;
  const { data, iv } = await vault_encrypt(vaultKey, JSON.stringify(w.data));
  const result = await apiFetch(`/api/widgets/${id}`, 'PUT', {
    title: w.title, data_enc: data, data_iv: iv,
    tags: JSON.parse(w.tags || '[]'), pinned,
  });
  const idx = allWidgets.findIndex(x => x.id === id);
  if (idx !== -1) allWidgets[idx] = { ...allWidgets[idx], ...result.widget, data: w.data };
  renderGrid();
}

function openDelete(id) {
  deleteTarget = id;
  document.getElementById('deleteModal').style.display = 'flex';
}

document.getElementById('deleteConfirmBtn').addEventListener('click', async () => {
  if (!deleteTarget) return;
  try {
    await apiFetch(`/api/widgets/${deleteTarget}`, 'DELETE');
    allWidgets = allWidgets.filter(w => w.id !== deleteTarget);
    renderGrid();
    toast('deleted', 'ok');
  } catch {
    toast('delete failed', 'err');
  }
  deleteTarget = null;
  document.getElementById('deleteModal').style.display = 'none';
});

document.getElementById('deleteCancelBtn').addEventListener('click',  () => {
  deleteTarget = null;
  document.getElementById('deleteModal').style.display = 'none';
});
document.getElementById('deleteModalClose').addEventListener('click', () => {
  deleteTarget = null;
  document.getElementById('deleteModal').style.display = 'none';
});

// ─── Modal close ──────────────────────────────────────────────────────────
function closeModal() {
  document.getElementById('widgetModal').style.display = 'none';
  editingId = null;
}

document.getElementById('modalClose').addEventListener('click',  closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);

document.getElementById('widgetModal').addEventListener('click', e => {
  if (e.target === document.getElementById('widgetModal')) closeModal();
});

// Close modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    document.getElementById('deleteModal').style.display = 'none';
  }
});

// ─── Form builders ────────────────────────────────────────────────────────
function makeField(name, label, type, value, placeholder, required, autofocus) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const isPassword = type === 'password';
  wrap.innerHTML = `
    <label class="field-label" for="mf_${name}">${esc(label)}</label>
    <div class="${isPassword ? 'field-wrap' : ''}">
      <input class="field-input" type="${type}" id="mf_${name}" name="${name}"
             value="${esc(value)}" placeholder="${esc(placeholder)}"
             ${required ? 'required' : ''} ${autofocus ? 'autofocus' : ''} />
      ${isPassword ? `<button type="button" class="field-eye" data-eye="mf_${name}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>` : ''}
    </div>`;

  if (isPassword) setupEyeToggle(wrap);
  return wrap;
}

function makePasswordField(name, label, value) {
  return makeField(name, label, 'password', value, '', false, false);
}

function makeTextarea(name, label, value, placeholder) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = `
    <label class="field-label" for="mf_${name}">${esc(label)}</label>
    <textarea class="field-textarea" id="mf_${name}" name="${name}"
              placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
  return wrap;
}

function makeCheckbox(name, label, checked) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = `
    <label class="field-checkbox">
      <input type="checkbox" name="${name}" ${checked ? 'checked' : ''} />
      ${esc(label)}
    </label>`;
  return wrap;
}

function makeIconUploadField(name, label, value) {
  const wrap = document.createElement('div');
  wrap.className = 'field';

  wrap.innerHTML = `
    <label class="field-label">${esc(label)}</label>
    <input type="hidden" name="${name}" value="${esc(value)}" />
    <div class="icon-upload-wrap">
      <div class="icon-upload-preview ${value ? '' : 'icon-upload-preview--empty'}">
        ${value
          ? `<img src="${esc(value)}" alt="" width="28" height="28" />`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`}
      </div>
      <label class="btn btn--ghost btn--sm icon-upload-btn">
        ${value ? 'change' : 'upload icon'}
        <input type="file" accept="image/*" style="display:none" />
      </label>
      ${value ? `<button type="button" class="btn btn--ghost btn--sm icon-upload-clear">remove</button>` : ''}
      <div class="icon-upload-err" style="display:none;font-size:.75rem;color:var(--danger)"></div>
    </div>`;

  const hidden  = wrap.querySelector(`input[name="${name}"]`);
  const preview = wrap.querySelector('.icon-upload-preview');
  const actions = wrap.querySelector('.icon-upload-wrap');
  const fileInput = wrap.querySelector('input[type="file"]');
  const errEl = wrap.querySelector('.icon-upload-err');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    errEl.style.display = 'none';

    const fd = new FormData();
    fd.append('icon', file);

    try {
      const res = await fetch('/api/widgets/icon', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf() },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed.');

      hidden.value = json.url;
      preview.classList.remove('icon-upload-preview--empty');
      preview.innerHTML = `<img src="${esc(json.url)}" alt="" width="28" height="28" />`;

      // Update button label + ensure clear button exists
      const lbl = actions.querySelector('.icon-upload-btn');
      lbl.childNodes[0].textContent = 'change ';

      let clearBtn = actions.querySelector('.icon-upload-clear');
      if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn--ghost btn--sm icon-upload-clear';
        clearBtn.textContent = 'remove';
        lbl.after(clearBtn);
        clearBtn.addEventListener('click', clearIcon);
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'inline';
    }
    fileInput.value = '';
  });

  function clearIcon() {
    hidden.value = '';
    preview.classList.add('icon-upload-preview--empty');
    preview.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    const clearBtn = actions.querySelector('.icon-upload-clear');
    if (clearBtn) clearBtn.remove();
    const lbl = actions.querySelector('.icon-upload-btn');
    lbl.childNodes[0].textContent = 'upload icon ';
  }

  const existingClear = wrap.querySelector('.icon-upload-clear');
  if (existingClear) existingClear.addEventListener('click', clearIcon);

  return wrap;
}

function makeTagsField(tagsStr) {
  let existing = [];
  try { existing = JSON.parse(tagsStr || '[]'); } catch {}

  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.innerHTML = `
    <label class="field-label">tags</label>
    <div class="tags-input-wrap" id="tagsWrap">
      ${existing.map(t => tagChip(t)).join('')}
      <input class="tags-input-field" id="tagsInput" placeholder="add tag…" type="text" />
    </div>`;

  const input = wrap.querySelector('#tagsInput');
  const tagsWrap = wrap.querySelector('#tagsWrap');

  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      const tag = input.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
      if (tag) {
        const chip = document.createElement('span');
        chip.className = 'tags-input-tag';
        chip.dataset.tag = tag;
        chip.innerHTML = `${esc(tag)} <button type="button">×</button>`;
        chip.querySelector('button').addEventListener('click', () => chip.remove());
        tagsWrap.insertBefore(chip, input);
      }
      input.value = '';
    }
    // Remove last tag on backspace
    if (e.key === 'Backspace' && !input.value) {
      const chips = tagsWrap.querySelectorAll('.tags-input-tag');
      if (chips.length) chips[chips.length - 1].remove();
    }
  });

  tagsWrap.addEventListener('click', () => input.focus());
  return wrap;
}

function tagChip(tag) {
  return `<span class="tags-input-tag" data-tag="${esc(tag)}">${esc(tag)} <button type="button">×</button></span>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────
async function apiFetch(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'X-CSRF-Token': csrf() },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, type = 'ok') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ─── Eye toggle (password show/hide) ─────────────────────────────────────
function setupEyeToggle(root) {
  root.querySelectorAll('.field-eye[data-eye]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.eye) ||
                    btn.closest('.field-wrap')?.querySelector('input');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}
document.addEventListener('DOMContentLoaded', () => setupEyeToggle(document));

// Also handle eye toggles in auth pages (outside vault.js scope handled by main.js)

// ─── Starfield + misc in main.js ──────────────────────────────────────────

// ─── Type icon helpers ────────────────────────────────────────────────────
function noteIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}
function reminderIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
}
function bookmarkIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
}
function accountIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
}
function birthdayIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
}
