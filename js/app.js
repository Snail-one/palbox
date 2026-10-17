(function () {
  'use strict';
  const C = window.PalConfig;
  const S = window.PalSchema;
  const knownKeys = new Set([...C.parse(PalTemplate).entries.map(entry => entry.key), ...Object.keys(S.fields)]);
  const $ = id => document.getElementById(id);
  const icon = name => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const uid = () => window.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const profile = (name, source) => ({ id: uid(), name, source, updatedAt: new Date().toISOString() });
  let workspace;
  let storageBlocked = false;
  let loadMessage = '';
  try {
    workspace = PalStorage.load(window.localStorage);
    if (workspace) workspace.profiles.forEach(p => C.parse(p.source));
  } catch (error) {
    storageBlocked = true;
    workspace = null;
    loadMessage = error.message + ' 当前使用临时工作空间，可以编辑并复制；请先备份或修复原始本地数据。';
  }
  if (!workspace) {
    const first = profile('我的帕鲁世界', PalTemplate);
    workspace = { version: 1, activeId: first.id, profiles: [first] };
    if (!storageBlocked) {
      try { PalStorage.save(window.localStorage, workspace); }
      catch (error) { loadMessage = error.message + ' 当前编辑仍可复制。'; }
    }
  }
  const state = {
    doc: null, baseline: null, changes: new Map(), errors: new Map(), drafts: new Map(),
    group: 'server', view: 'form', advanced: 'table', search: '', sourceDraft: null, unknownOnly: false,
    persisted: !loadMessage, nameChanged: false
  };
  const active = () => workspace.profiles.find(p => p.id === workspace.activeId);
  const isUnknown = entry => !knownKeys.has(entry.key);
  const raw = key => state.changes.has(key) ? state.changes.get(key) : state.doc.entries.find(e => e.key === key)?.raw;
  const currentSource = () => C.serialize(state.doc, state.changes);
  const parameterChanges = () => {
    const before = new Map(state.baseline.entries.map(e => [e.key, e.raw]));
    const after = new Map(state.doc.entries.map(e => [e.key, raw(e.key)]));
    return [...new Set([...before.keys(), ...after.keys()])].filter(k => before.get(k) !== after.get(k));
  };
  const isDirty = () => !state.persisted || state.nameChanged || state.sourceDraft !== null || state.errors.size > 0 || currentSource() !== active().source;
  const isModified = key => state.baseline.entries.find(e => e.key === key)?.raw !== raw(key);
  const empty = node => node.replaceChildren();
  let toastTimeout;
  function toast(message, error = false) {
    clearTimeout(toastTimeout);
    $('toast').textContent = message;
    $('toast').classList.toggle('error', error);
    $('toast').hidden = false;
    toastTimeout = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 3500);
  }
  function showStorageError(message) {
    $('storage-error').textContent = message;
    $('storage-error').hidden = !message;
  }
  function persist() {
    if (storageBlocked) { showStorageError(loadMessage); toast('原始本地数据存在问题，已阻止覆盖。请先复制配置备份。', true); return false; }
    try {
      PalStorage.save(window.localStorage, workspace);
      state.persisted = true;
      showStorageError('');
      return true;
    } catch (error) {
      state.persisted = false;
      showStorageError(error.message);
      toast(error.message, true);
      return false;
    }
  }
  function useProfile(id, persisted = true) {
    workspace.activeId = id;
    state.doc = C.parse(active().source);
    state.baseline = C.parse(active().source);
    state.changes.clear(); state.errors.clear(); state.drafts.clear();
    state.sourceDraft = null; state.nameChanged = false; state.persisted = persisted;
    $('source-error').hidden = true;
    render();
  }
  function savedTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '本地配置';
    return `更新于 ${date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  function renderProfiles() {
    empty($('profile-list'));
    $('profile-count').textContent = workspace.profiles.length;
    for (const p of workspace.profiles) {
      const button = el('button', `profile-item${p.id === workspace.activeId ? ' selected' : ''}`);
      if (p.id === workspace.activeId) button.setAttribute('aria-current', 'true');
      const text = el('span', 'profile-item-text');
      text.append(el('strong', '', p.name), el('small', '', 'PalWorldSettings.ini'));
      button.append(icon('file'), text);
      if (p.id === workspace.activeId) button.append(icon('arrow'));
      button.addEventListener('click', async () => {
        if (p.id === workspace.activeId) { closeSidebar(); return; }
        if (!(await allowDiscard())) return;
        const wasPersisted = state.persisted;
        useProfile(p.id, wasPersisted);
        persist();
        renderStatus(); closeSidebar();
      });
      $('profile-list').append(button);
    }
  }
  function renderStatus() {
    $('parameter-count').textContent = state.doc.entries.length;
    const unknownCount = state.doc.entries.filter(isUnknown).length;
    $('unknown-count').textContent = unknownCount;
    $('unknown-summary').setAttribute('aria-label', `查看和编辑 ${unknownCount} 项未识别参数`);
    $('player-count').textContent = raw('ServerPlayerMaxNum') ?? '—';
    $('change-count').textContent = parameterChanges().length;
    let message = isDirty() ? '有更改尚未保存' : '所有更改已保存';
    if (state.sourceDraft !== null) message = '源码待应用';
    if (state.errors.size) message = `${state.errors.size} 项输入需要修正`;
    if (!state.persisted) message = '更改尚未存入浏览器';
    $('change-caption').textContent = message;
    $('save-state').replaceChildren(icon(isDirty() ? 'edit' : 'check'), document.createTextNode(message));
    $('save-state').classList.toggle('unsaved', isDirty());
    $('profile-title').textContent = active().name;
    $('profile-server').textContent = C.decodeString(raw('ServerName') || 'PalWorldSettings.ini');
    $('profile-updated').textContent = savedTime(active().updatedAt);
    document.title = `${isDirty() ? '● ' : ''}${active().name} · Palbox`;
  }
  function renderCategories() {
    empty($('category-nav'));
    for (const group of S.groups) {
      const button = el('button', `category-button${group.id === state.group && !state.search ? ' active' : ''}`, undefined);
      button.append(icon(group.icon), document.createTextNode(group.name));
      button.setAttribute('aria-pressed', String(group.id === state.group && !state.search));
      button.addEventListener('click', () => {
        state.group = group.id;
        state.search = ''; $('search').value = '';
        renderCategories(); renderFields();
      });
      $('category-nav').append(button);
    }
  }
  function matches(entry) {
    const query = state.search.trim().toLowerCase();
    return !query || `${entry.key} ${S.fields[entry.key]?.label || ''}`.toLowerCase().includes(query);
  }
  function labelWithDot(field) {
    const label = el('label', 'field-label', field.label);
    label.htmlFor = `field-${field.key}`;
    if (isModified(field.key)) {
      const dot = el('span', 'modified-dot');
      dot.title = '本次已修改'; label.append(dot);
    }
    return label;
  }
  function setFieldError(key, message, control, errorNode) {
    if (message) state.errors.set(key, message); else state.errors.delete(key);
    control.setAttribute('aria-invalid', String(Boolean(message)));
    if (errorNode) errorNode.textContent = message || '';
  }
  function updateValue(key, nextRaw, control, errorNode) {
    let message;
    try { C.validateRaw(nextRaw); message = S.validate(key, nextRaw); }
    catch (error) { message = error.message; }
    state.drafts.set(key, control.value);
    setFieldError(key, message, control, errorNode);
    if (!message) {
      const initial = state.doc.entries.find(e => e.key === key)?.raw;
      if (nextRaw === initial) state.changes.delete(key); else state.changes.set(key, nextRaw);
      state.drafts.delete(key);
    }
    const field = control.closest('.field');
    if (field) {
      const label = field.querySelector('.field-label');
      label?.querySelector('.modified-dot')?.remove();
      if (isModified(key)) { const dot = el('span', 'modified-dot'); dot.title = '本次已修改'; label?.append(dot); }
    }
    control.closest('tr')?.classList.toggle('modified', isModified(key));
    renderStatus();
  }
  function renderFields() {
    empty($('fields-grid'));
    const group = S.groups.find(g => g.id === state.group);
    $('group-icon').replaceChildren(icon(state.search ? 'search' : group.icon));
    $('group-title').textContent = state.search ? '搜索结果' : `${group.name}设置`;
    $('group-description').textContent = state.search ? `匹配「${state.search}」的可视化参数` : group.subtitle;
    const entries = Object.keys(S.fields).map(key => state.doc.entries.find(e => e.key === key)).filter(Boolean)
      .filter(e => matches(e) && (state.search || S.fields[e.key].group === state.group));
    $('group-count').textContent = `${entries.length} 项参数`;
    $('empty-state').hidden = entries.length > 0;
    for (const entry of entries) {
      const f = S.fields[entry.key];
      const value = raw(entry.key);
      const box = el('div', `field${f.wide ? ' wide' : ''}${f.type === 'boolean' ? ' boolean-field' : ''}`);
      const label = labelWithDot(f);
      const keyLabel = el('div', 'field-key', entry.key);
      const description = el('p', 'field-description', f.description);
      description.id = `desc-${entry.key}`;
      const errorNode = el('p', 'field-error', state.errors.get(entry.key) || '');
      errorNode.id = `error-${entry.key}`;
      errorNode.setAttribute('aria-live', 'polite');
      let control;
      if (f.type === 'boolean') {
        const info = el('div', 'boolean-info');
        info.append(label, keyLabel, description, errorNode);
        control = el('button', 'toggle');
        control.setAttribute('role', 'switch');
        control.setAttribute('aria-checked', String(value === 'True'));
        control.setAttribute('aria-label', f.label);
        control.addEventListener('click', () => {
          const checked = control.getAttribute('aria-checked') !== 'true';
          control.setAttribute('aria-checked', String(checked));
          updateValue(entry.key, checked ? 'True' : 'False', control, errorNode);
        });
        box.append(info, control);
      } else {
        box.append(el('div', 'field-top'));
        box.firstChild.append(label);
        box.append(keyLabel);
        const wrap = el('div', 'input-wrap');
        if (f.type === 'select') {
          control = el('select', 'field-input field-select');
          for (const [v, name] of Object.entries(f.options)) {
            const option = el('option', '', name); option.value = v; control.append(option);
          }
          const decoded = C.decodeString(value);
          if (!Object.hasOwn(f.options, decoded)) { const option = el('option', '', `原始值：${decoded}`); option.value = decoded; control.append(option); }
          control.value = decoded;
          control.addEventListener('change', () => updateValue(entry.key, value.startsWith('"') ? C.encodeString(control.value) : control.value, control, errorNode));
          wrap.append(control);
        } else if (f.type === 'platforms') {
          control = el('fieldset', 'platform-fieldset');
          control.style.cssText = 'border:0;padding:0;margin:0;min-width:0;width:100%';
          control.append(el('legend', 'sr-only', f.label));
          const choices = el('div', 'platform-options');
          const platforms = /^\([^()]*\)$/.test(value) ? value.slice(1, -1).split(',').map(v => v.trim()).filter(Boolean) : null;
          if (platforms && platforms.every(v => /^[A-Za-z0-9_]+$/.test(v))) {
            for (const name of [...new Set(['Steam', 'Xbox', 'PS5', 'Mac', ...platforms])]) {
              const choice = el('label', 'platform-choice');
              const check = el('input'); check.type = 'checkbox'; check.value = name; check.checked = platforms.includes(name);
              choice.append(check, document.createTextNode(name)); choices.append(choice);
              check.addEventListener('change', () => {
                const selected = [...choices.querySelectorAll('input:checked')].map(n => n.value);
                updateValue(entry.key, `(${selected.join(',')})`, control, errorNode);
              });
            }
            control.append(choices);
          } else control.append(el('p', 'platform-warning', '当前平台值为特殊格式，请在高级编辑中修改。'));
          wrap.append(control);
        } else {
          control = el('input', `field-input${f.unit ? ' has-unit' : ''}${f.secret ? ' field-secret' : ''}`);
          control.type = f.secret ? 'password' : 'text';
          control.autocomplete = 'off';
          if (f.type === 'number') control.inputMode = f.integer ? 'numeric' : 'decimal';
          control.value = state.drafts.has(entry.key) ? state.drafts.get(entry.key) : f.type === 'text' ? C.decodeString(value) : value;
          control.addEventListener('input', () => {
            let next;
            try { next = f.type === 'text' ? C.encodeString(control.value) : control.value.trim(); }
            catch (error) { setFieldError(entry.key, error.message, control, errorNode); renderStatus(); return; }
            updateValue(entry.key, next, control, errorNode);
          });
          wrap.append(control);
          if (f.unit) wrap.append(el('span', 'input-unit', f.unit));
          if (f.secret) {
            const reveal = el('button', 'icon-button reveal-button');
            reveal.type = 'button'; reveal.setAttribute('aria-label', `显示${f.label}`); reveal.setAttribute('aria-pressed', 'false'); reveal.append(icon('eye'));
            reveal.addEventListener('click', () => {
              const visible = control.type === 'password'; control.type = visible ? 'text' : 'password';
              reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${f.label}`); reveal.setAttribute('aria-pressed', String(visible));
            });
            wrap.append(reveal);
          }
        }
        box.append(wrap, description, errorNode);
      }
      control.id = `field-${entry.key}`;
      control.setAttribute('aria-describedby', `${description.id} ${errorNode.id}`);
      control.setAttribute('aria-invalid', String(state.errors.has(entry.key)));
      $('fields-grid').append(box);
    }
  }
  function renderTable() {
    empty($('parameter-rows'));
    const unknownCount = state.doc.entries.filter(isUnknown).length;
    const entries = state.doc.entries.filter(e => matches(e) && (!state.unknownOnly || isUnknown(e)));
    $('unknown-only').checked = state.unknownOnly;
    $('table-count').textContent = `共 ${unknownCount} 项未识别参数 · 当前显示 ${entries.length} 项`;
    $('table-empty').hidden = entries.length > 0;
    $('table-empty').textContent = state.unknownOnly
      ? (unknownCount === 0 ? '当前配置没有未识别参数。' : '没有匹配的未识别参数，试试其他关键词。')
      : '没有匹配的参数。';
    for (const entry of entries) {
      const row = el('tr', isModified(entry.key) ? 'modified' : '');
      const name = el('td', '', entry.key);
      if (S.fields[entry.key]) name.append(el('small', '', S.fields[entry.key].label));
      else if (isUnknown(entry)) name.append(el('small', 'unknown-tag', '未识别参数'));
      else name.append(el('small', '', '模板参数 · 暂无中文控件'));
      const cell = el('td');
      const wrap = el('div', 'input-wrap');
      const secret = S.fields[entry.key]?.secret;
      const input = el('input', `raw-input${secret ? ' field-secret' : ''}`);
      input.type = secret ? 'password' : 'text'; input.autocomplete = 'off'; input.spellcheck = false;
      input.value = state.drafts.has(entry.key) ? state.drafts.get(entry.key) : raw(entry.key);
      input.setAttribute('aria-label', `${entry.key} 的原始值`);
      const errorNode = el('p', 'field-error', state.errors.get(entry.key) || '');
      errorNode.id = `raw-error-${entry.key}`; errorNode.setAttribute('aria-live', 'polite');
      input.setAttribute('aria-describedby', errorNode.id);
      input.setAttribute('aria-invalid', String(state.errors.has(entry.key)));
      input.addEventListener('input', () => updateValue(entry.key, input.value.trim(), input, errorNode));
      wrap.append(input);
      if (secret) {
        const reveal = el('button', 'icon-button reveal-button'); reveal.setAttribute('aria-label', `显示 ${entry.key}`); reveal.setAttribute('aria-pressed', 'false'); reveal.append(icon('eye'));
        reveal.addEventListener('click', () => {
          const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
          reveal.setAttribute('aria-pressed', String(visible)); reveal.setAttribute('aria-label', `${visible ? '隐藏' : '显示'} ${entry.key}`);
        });
        wrap.append(reveal);
      }
      cell.append(wrap, errorNode); row.append(name, cell); $('parameter-rows').append(row);
    }
  }
  function renderView() {
    $('view-form').hidden = state.view !== 'form';
    $('view-advanced').hidden = state.view !== 'advanced';
    for (const view of ['form', 'advanced']) {
      $('tab-' + view).classList.toggle('active', state.view === view);
      $('tab-' + view).setAttribute('aria-selected', String(state.view === view));
      $('tab-' + view).tabIndex = state.view === view ? 0 : -1;
    }
    $('table-container').hidden = state.advanced !== 'table';
    $('source-container').hidden = state.advanced !== 'source';
    for (const mode of ['table', 'source']) {
      $('mode-' + mode).classList.toggle('selected', mode === state.advanced);
      $('mode-' + mode).setAttribute('aria-pressed', String(mode === state.advanced));
    }
    if (state.view === 'form') renderFields();
    else if (state.advanced === 'table') renderTable();
    else $('source-editor').value = state.sourceDraft ?? currentSource();
  }
  function render() { renderProfiles(); renderCategories(); renderView(); renderStatus(); }
  function editableReady() {
    if (state.sourceDraft !== null) { toast('请先应用源码修改，或还原源码后再操作。', true); return false; }
    if (state.errors.size) { toast('请先修正标记的输入错误。', true); return false; }
    return true;
  }
  function saveCurrent() {
    if (!editableReady()) return false;
    const next = currentSource();
    C.parse(next);
    const previous = { ...active() };
    active().source = next; active().updatedAt = new Date().toISOString();
    if (!persist()) {
      Object.assign(active(), previous);
      renderStatus(); return false;
    }
    state.doc = C.parse(next); state.baseline = C.parse(next);
    state.changes.clear(); state.drafts.clear(); state.nameChanged = false;
    render(); toast('配置已保存到当前浏览器'); return true;
  }
  function copyFallback(text) {
    const focused = document.activeElement;
    const input = el('textarea');
    input.value = text;
    input.readOnly = true;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(input);
    try {
      input.focus(); input.select();
      if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
    } finally {
      input.remove();
      focused?.focus({ preventScroll: true });
    }
  }
  async function copyCurrent() {
    if (!editableReady()) return;
    try {
      const text = C.serialize(state.doc, state.changes, { download: true });
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); }
        catch { copyFallback(text); }
      } else copyFallback(text);
      toast('完整 INI 配置已复制到剪贴板');
    } catch { toast('复制失败，请允许剪贴板访问，或在「高级编辑 → INI 源码」中手动复制。', true); }
  }

  let pendingDialog = null;
  function ask({ title, description, name, confirm = '确认', danger = false, symbol = 'file' }) {
    return new Promise(resolve => {
      pendingDialog = resolve;
      $('dialog-title').textContent = title; $('dialog-description').textContent = description;
      $('dialog-icon').replaceChildren(icon(symbol));
      $('dialog-name-label').hidden = name === undefined;
      $('dialog-name').value = name ?? ''; $('dialog-name').required = name !== undefined;
      $('dialog-error').hidden = true;
      $('dialog-confirm').textContent = confirm;
      $('dialog-confirm').style.backgroundColor = danger ? 'var(--red)' : '';
      $('action-dialog').showModal();
      if (name !== undefined) { $('dialog-name').focus(); $('dialog-name').select(); }
      else $('dialog-cancel').focus();
    });
  }
  function finishDialog(value) {
    $('action-dialog').close();
    const resolve = pendingDialog; pendingDialog = null;
    resolve?.(value);
  }
  $('action-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('dialog-name-label').hidden && !$('dialog-name').value.trim()) {
      $('dialog-error').textContent = '请输入配置名称。'; $('dialog-error').hidden = false; return;
    }
    finishDialog($('dialog-name-label').hidden ? true : $('dialog-name').value.trim());
  });
  $('dialog-cancel').addEventListener('click', () => finishDialog(null));
  $('dialog-close').addEventListener('click', () => finishDialog(null));
  $('action-dialog').addEventListener('cancel', event => { event.preventDefault(); finishDialog(null); });
  async function allowDiscard() {
    if (!isDirty()) return true;
    return Boolean(await ask({ title: '离开当前配置？', description: '当前配置有尚未保存的更改，继续将放弃这些编辑。你可以取消并先保存或复制。', confirm: '放弃更改', danger: true, symbol: 'edit' }));
  }
  async function newProfile() {
    if (!(await allowDiscard())) return;
    const name = await ask({ title: '创建一个新的世界', description: '使用你提供的完整模板，开始一套独立配置。', name: '新的帕鲁世界', confirm: '创建配置', symbol: 'plus' });
    if (!name) return;
    const p = profile(name, PalTemplate); workspace.profiles.push(p); useProfile(p.id, false);
    const success = persist(); render(); closeSidebar();
    if (success) toast('新配置已创建');
  }
  $('new-profile').addEventListener('click', newProfile);
  $('rename-profile').addEventListener('click', async () => {
    const name = await ask({ title: '给世界起个名字', description: '配置名称用于在工作台中区分不同世界，不会修改服务器名称。', name: active().name, confirm: '保存名称', symbol: 'edit' });
    if (!name || name === active().name) return;
    active().name = name;
    state.nameChanged = true;
    // Persisting the workspace only stores the last saved source, never partial edits.
    if (persist()) state.nameChanged = false;
    renderProfiles(); renderStatus();
  });
  $('copy-profile').addEventListener('click', async () => {
    if (!editableReady()) return;
    const name = await ask({ title: '复制这套配置', description: '副本包含当前编辑中的所有有效参数；原配置保留上一次保存的内容。', name: active().name + ' · 副本', confirm: '复制配置', symbol: 'copy' });
    if (!name) return;
    const p = profile(name, currentSource());
    workspace.profiles.push(p); useProfile(p.id, false);
    const success = persist(); render(); if (success) toast('已创建独立副本');
  });
  $('delete-profile').addEventListener('click', async () => {
    const yes = await ask({ title: '删除这套配置？', description: `「${active().name}」将从浏览器中删除${isDirty() ? '，包括尚未保存的更改' : ''}。${workspace.profiles.length === 1 ? '删除后会创建一套默认配置。' : '其他配置不受影响。'}`, confirm: '删除配置', danger: true, symbol: 'trash' });
    if (!yes) return;
    workspace.profiles = workspace.profiles.filter(p => p.id !== workspace.activeId);
    if (!workspace.profiles.length) workspace.profiles.push(profile('我的帕鲁世界', PalTemplate));
    useProfile(workspace.profiles[0].id, false);
    const success = persist(); render(); if (success) toast('配置已删除');
  });
  $('save-button').addEventListener('click', saveCurrent);
  $('header-save-button').addEventListener('click', saveCurrent);
  $('header-copy-button').addEventListener('click', copyCurrent);
  $('copy-button').addEventListener('click', copyCurrent);
  $('unknown-summary').addEventListener('click', () => {
    if (!editableReady()) return;
    state.view = 'advanced'; state.advanced = 'table'; state.unknownOnly = true;
    state.search = ''; $('search').value = '';
    renderCategories(); renderView();
    $('tab-advanced').focus({ preventScroll: true });
    $('view-advanced').scrollIntoView({ block: 'start' });
  });
  $('unknown-only').addEventListener('change', () => {
    state.unknownOnly = $('unknown-only').checked;
    renderTable();
  });

  for (const view of ['form', 'advanced']) $('tab-' + view).addEventListener('click', () => {
    if (state.view === view) return;
    if (state.sourceDraft !== null || state.errors.size) { editableReady(); return; }
    state.view = view; renderView();
  });
  document.querySelector('.view-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const view = event.key === 'Home' ? 'form' : event.key === 'End' ? 'advanced' : state.view === 'form' ? 'advanced' : 'form';
    $('tab-' + view).click(); $('tab-' + state.view).focus();
  });
  for (const mode of ['table', 'source']) $('mode-' + mode).addEventListener('click', () => {
    if (state.advanced === mode) return;
    if (state.sourceDraft !== null || state.errors.size) { editableReady(); return; }
    state.advanced = mode; renderView();
  });
  $('search').addEventListener('input', () => {
    state.search = $('search').value.trim(); renderCategories();
    if (state.view === 'form') renderFields(); else renderTable();
  });
  $('source-editor').addEventListener('input', () => {
    state.sourceDraft = $('source-editor').value === currentSource() ? null : $('source-editor').value;
    $('source-error').hidden = true; renderStatus();
  });
  const restoreSource = el('button', 'button secondary', '还原源码');
  restoreSource.id = 'restore-source';
  $('apply-source').before(restoreSource);
  restoreSource.addEventListener('click', async () => {
    if (state.sourceDraft !== null) {
      const discard = await ask({ title: '还原源码？', description: '放弃尚未应用的源码编辑，恢复为当前已应用的配置。', confirm: '还原源码', symbol: 'code' });
      if (!discard) return;
    }
    state.sourceDraft = null; $('source-editor').value = currentSource(); $('source-error').hidden = true; renderStatus();
  });
  $('apply-source').addEventListener('click', () => {
    try {
      const doc = C.parse($('source-editor').value);
      for (const entry of doc.entries) {
        if (raw(entry.key) === entry.raw) continue;
        const error = S.validate(entry.key, entry.raw);
        if (error) throw new Error(`${entry.key}：${error}`);
      }
      state.doc = doc; state.changes.clear(); state.errors.clear(); state.drafts.clear(); state.sourceDraft = null;
      $('source-error').hidden = true; renderStatus(); toast('源码已应用，表单已同步');
    } catch (error) { $('source-error').textContent = error.message; $('source-error').hidden = false; }
  });

  async function openImport() {
    if (!(await allowDiscard())) return;
    $('import-text').value = ''; $('import-name').value = ''; $('file-input').value = '';
    $('import-error').hidden = true; $('import-dialog').showModal(); closeSidebar();
  }
  $('import-button').addEventListener('click', openImport);
  $('sidebar-import').addEventListener('click', openImport);
  let importReadVersion = 0;
  function closeImport() { importReadVersion++; $('import-dialog').close(); }
  $('import-close').addEventListener('click', closeImport);
  $('import-cancel').addEventListener('click', closeImport);
  $('import-dialog').addEventListener('cancel', () => { importReadVersion++; });
  async function readFile(file) {
    if (!file) return;
    const version = ++importReadVersion;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB，请选择服务器 INI 配置文件。');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      C.parse(text);
      if (version !== importReadVersion || !$('import-dialog').open) return;
      $('import-text').value = text;
      $('import-name').value = file.name.replace(/\.(ini|txt)$/i, '') || '导入的配置';
      $('import-error').hidden = true;
    } catch (error) {
      if (version !== importReadVersion || !$('import-dialog').open) return;
      $('import-error').textContent = error.message; $('import-error').hidden = false;
    }
  }
  $('file-input').addEventListener('change', () => readFile($('file-input').files[0]));
  $('drop-zone').addEventListener('keydown', event => {
    if (event.target !== $('drop-zone')) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('file-input').click(); }
  });
  for (const event of ['dragenter', 'dragover']) $('drop-zone').addEventListener(event, e => { e.preventDefault(); $('drop-zone').classList.add('dragover'); });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragover'));
  $('drop-zone').addEventListener('drop', event => {
    event.preventDefault(); $('drop-zone').classList.remove('dragover'); readFile(event.dataTransfer.files[0]);
  });
  $('import-confirm').addEventListener('click', () => {
    try {
      const source = $('import-text').value;
      if (new Blob([source]).size > 2 * 1024 * 1024) throw new Error('配置超过 2 MB，请检查粘贴的内容。');
      C.parse(source);
      const p = profile($('import-name').value.trim() || '导入的配置', source);
      workspace.profiles.push(p); useProfile(p.id, false);
      const success = persist(); render(); closeImport();
      if (success) toast('导入成功，所有原始参数均已保留');
    } catch (error) { $('import-error').textContent = error.message; $('import-error').hidden = false; }
  });
  function closeSidebar() {
    $('sidebar').classList.remove('open'); $('sidebar-scrim').hidden = true;
    $('mobile-menu').setAttribute('aria-expanded', 'false');
  }
  $('mobile-menu').addEventListener('click', () => {
    const open = !$('sidebar').classList.contains('open');
    $('sidebar').classList.toggle('open', open); $('sidebar-scrim').hidden = !open;
    $('mobile-menu').setAttribute('aria-expanded', String(open));
  });
  $('sidebar-scrim').addEventListener('click', closeSidebar);
  window.addEventListener('beforeunload', event => {
    if (isDirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  document.addEventListener('keydown', event => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    const modalOpen = $('action-dialog').open || $('import-dialog').open;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !modalOpen) { event.preventDefault(); saveCurrent(); }
    if (event.key === '/' && !typing && !modalOpen) { event.preventDefault(); $('search').focus(); }
    if (event.key === 'Escape' && !modalOpen) closeSidebar();
  });
  useProfile(workspace.activeId, !loadMessage);
  if (loadMessage) showStorageError(loadMessage);
})();
