(function clientApp() {
  const UI_KEY = 'copropro_ui_state_v1';
  const ACCESS_TOKEN_KEY = 'copropro_access_token';
  const FALLBACK_FILTER = 'Filtre';
  const DEFAULT_APP_TITLE = 'Gestion d\'Incidents';
  const PAGE_TITLES = {
    incidents: DEFAULT_APP_TITLE,
    directory: 'Annuaire',
    contract: 'Contrats'
  };
  const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
  const TOPIC_STATUSES = new Set(['urgent', 'todo', 'partial', 'resolved']);
  initAccessToken();
  const state = {
    topics: [],
    serverFilters: [],
    configFilters: [],
    propertyAddress: '',
    syndicName: '',
    activeFilter: 'all',
    statFilter: 'active',
    search: '',
    editMode: false,
    filterOrder: [],
    extraFilters: [],
    deletingTopicIds: new Set(),
    view: 'incidents'
  };
  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bind();
    await loadConfig();
    restoreUi();
    bindEvents();
    await loadFromApi();
    renderAll();
    renderView();
  }

  function bind() {
    [
      'edit-banner',
      'app-main-title',
      'app-main-subtitle',
      'edit-toggle-btn',
      'header-bold-btn',
      'header-list-btn',
      'theme-toggle-btn',
      'content-loader-status',
      'filter-tabs',
      'search-input',
      'topics-section',
      'document-explorer-tree',
      'new-topic-btn',
      'new-topic-dialog',
      'new-topic-form',
      'new-topic-filter',
      'new-topic-status',
      'new-topic-title',
      'new-topic-body',
      'new-topic-bold-btn',
      'new-topic-list-btn',
      'new-topic-actions-list',
      'new-topic-action-add',
      'new-topic-cancel',
      'lightbox',
      'lightbox-img',
      'lightbox-title',
      'lightbox-desc',
      'lightbox-close'
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function iconElement(name) {
    const img = document.createElement('img');
    img.className = 'ui-icon';
    img.src = `assets/svg/${name}.svg`;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    return img;
  }

  function iconHtml(name, className = 'ui-icon') {
    return `<img class="${className}" src="assets/svg/${name}.svg" alt="" aria-hidden="true">`;
  }

  function setIconText(element, iconName, label) {
    element.replaceChildren(iconElement(iconName), document.createTextNode(label ? ` ${label}` : ''));
  }

  function setIconOnly(element, iconName, label) {
    element.replaceChildren(iconElement(iconName));
    element.ariaLabel = label;
    element.title = label;
  }

  function bindEvents() {
    els['edit-toggle-btn'].onclick = () => setEditMode(!state.editMode);
    bindHeaderFormat('header-bold-btn', 'bold');
    bindHeaderFormat('header-list-btn', 'insertUnorderedList');
    els['theme-toggle-btn'].onclick = toggleTheme;
    els['search-input'].oninput = (event) => {
      state.search = event.target.value.toLowerCase().trim();
      renderTopics();
      renderExplorer();
    };
    document.querySelectorAll('.stat-card').forEach((card) => {
      card.onclick = () => {
        state.statFilter = card.dataset.statFilter;
        renderAll();
      };
    });
    els['app-main-title'].oninput = saveUi;
    els['app-main-subtitle'].oninput = saveHeaderConfig;
    els['new-topic-btn'].onclick = openNew;
    els['new-topic-bold-btn'].onclick = () => formatTextareaSelection('bold');
    els['new-topic-list-btn'].onclick = () => formatTextareaSelection('list');
    els['new-topic-action-add'].onclick = () => addNewActionInput('');
    els['new-topic-cancel'].onclick = () => els['new-topic-dialog'].close();
    els['new-topic-form'].onsubmit = createNew;
    els['lightbox-close'].onclick = () => els.lightbox.close();
    els.lightbox.onclick = (event) => {
      if (event.target === els.lightbox) els.lightbox.close();
    };
    window.addEventListener('hashchange', renderView);
    document.addEventListener('wheel', rescueTrappedWheel, { capture: true, passive: false });
  }

  function rescueTrappedWheel(event) {
    if (!event.deltaY || event.defaultPrevented || hasOpenDialog()) return;
    const target = event.target instanceof Element ? event.target : event.target && event.target.parentElement;
    const scroller = target && target.closest('.filter-tabs, .new-topic-dialog, .lightbox-dialog, textarea, [contenteditable="true"]');
    if (!scroller || !canTrapVerticalScroll(scroller)) return;

    const atTop = scroller.scrollTop <= 0;
    const atBottom = Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight;
    if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
      event.preventDefault();
      window.scrollBy({ top: event.deltaY, left: 0, behavior: 'auto' });
    }
  }

  function hasOpenDialog() {
    return Boolean((els['new-topic-dialog'] && els['new-topic-dialog'].open) || (els.lightbox && els.lightbox.open));
  }

  function canTrapVerticalScroll(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    const style = window.getComputedStyle(element);
    const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    return scrollableY || element.matches('.filter-tabs, textarea, [contenteditable="true"]');
  }

  function restoreUi() {
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      els['app-main-title'].textContent = ui.title && ui.title !== 'Copropro' ? ui.title : DEFAULT_APP_TITLE;
      document.body.classList.toggle('light-theme', ui.theme !== 'dark');
    } catch {
      document.body.classList.add('light-theme');
    }
    initTheme();
    renderHeaderConfig();
  }

  function persistUi() {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        title: text(els['app-main-title']) || DEFAULT_APP_TITLE,
        theme: document.body.classList.contains('light-theme') ? 'light' : 'dark'
      })
    );
  }

  function currentViewFromHash() {
    if (window.location.hash === '#annuaire') return 'directory';
    if (window.location.hash === '#contrat') return 'contract';
    return 'incidents';
  }

  function renderView() {
    state.view = currentViewFromHash();
    const pageTitle = PAGE_TITLES[state.view] || DEFAULT_APP_TITLE;
    document.body.dataset.view = state.view;
    if (document.activeElement !== els['app-main-title']) els['app-main-title'].textContent = pageTitle;
    document.title = `${pageTitle} — Copropro`;
    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.viewPanel !== state.view;
    });
    document.querySelectorAll('[data-nav-view]').forEach((link) => {
      const isActive = link.dataset.navView === state.view;
      link.classList.toggle('active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function saveUi() {
    persistUi();
    renderView();
  }

  async function loadConfig() {
    try {
      applyConfig(await api('/api/config'));
    } catch (error) {
      console.warn(error);
      try {
        const response = await fetch('assets/config.md', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Erreur ${response.status}`);
        applyConfig(parseConfigMarkdown(await response.text()));
      } catch (fallbackError) {
        console.warn(fallbackError);
        applyConfig({ propertyAddress: '', syndicName: '', filters: [FALLBACK_FILTER] });
      }
    }
  }

  function applyConfig(config, options = {}) {
    state.propertyAddress = text(config.propertyAddress ?? config.address ?? '');
    state.syndicName = text(config.syndicName ?? config.syndic ?? '');
    state.configFilters = unique((Array.isArray(config.filters) ? config.filters : []).map(text).filter(Boolean));
    state.filterOrder = state.configFilters.slice();
    if (options.renderHeader !== false) renderHeaderConfig();
  }

  function renderHeaderConfig() {
    if (!els['app-main-subtitle']) return;
    const subtitle = [state.propertyAddress, state.syndicName].filter(Boolean).join(' — ');
    els['app-main-subtitle'].textContent = subtitle;
    els['app-main-subtitle'].dataset.placeholder = subtitle || 'Adresse — Syndic';
  }

  function saveHeaderConfig() {
    const raw = text(els['app-main-subtitle']);
    const parts = raw.split(/\s+[—-]\s+/);
    state.propertyAddress = parts.shift() || '';
    state.syndicName = parts.join(' — ');
    els['app-main-subtitle'].dataset.placeholder = raw || 'Adresse — Syndic';
    saveConfigDebounced();
  }

  let configSaveTimer = null;
  function saveConfigDebounced() {
    clearTimeout(configSaveTimer);
    configSaveTimer = setTimeout(saveConfig, 300);
  }

  async function saveConfig() {
    try {
      const config = await api('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyAddress: state.propertyAddress,
          syndicName: state.syndicName,
          filters: filters()
        })
      });
      applyConfig(config, { renderHeader: document.activeElement !== els['app-main-subtitle'] });
      setStatus('Configuration enregistrée dans assets/config.md.', 'ok');
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible d’écrire assets/config.md.', 'warn');
    }
  }

  function parseConfigMarkdown(markdown) {
    const config = { propertyAddress: '', syndicName: '', filters: [] };
    let section = '';
    String(markdown || '').split(/\r?\n/).forEach((line) => {
      const heading = line.match(/^##\s+(.+)$/);
      if (heading) {
        section = heading[1].trim().toLowerCase();
        return;
      }
      const address = line.match(/^Adresse\s*:\s*(.*)$/i);
      if (address) {
        config.propertyAddress = text(address[1]);
        return;
      }
      const syndic = line.match(/^Syndic\s*:\s*(.*)$/i);
      if (syndic) {
        config.syndicName = text(syndic[1]);
        return;
      }
      const filter = line.match(/^\s*-\s+(.+)$/);
      if (section === 'filtres' && filter) config.filters.push(text(filter[1]));
    });
    return config;
  }

  function initTheme() {
    const isLight = document.body.classList.contains('light-theme');
    els['theme-toggle-btn'].replaceChildren(iconElement(isLight ? 'moon' : 'sun'));
    els['theme-toggle-btn'].ariaLabel = isLight ? 'Activer le thème sombre' : 'Activer le thème clair';
    els['theme-toggle-btn'].title = isLight ? 'Activer le thème sombre' : 'Activer le thème clair';
  }

  function toggleTheme() {
    document.body.classList.toggle('light-theme');
    initTheme();
    persistUi();
  }

  function setEditMode(value) {
    state.editMode = value;
    document.body.classList.toggle('edit-mode-active', value);
    els['edit-banner'].classList.toggle('active', value);
    setIconOnly(els['edit-toggle-btn'], value ? 'save' : 'edit', value ? 'Quitter l\'édition' : 'Éditer le texte');
    [els['app-main-title'], els['app-main-subtitle']].forEach((element) => {
      element.contentEditable = value;
    });
    renderAll();
  }

  function bindHeaderFormat(id, command) {
    const button = els[id];
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = () => formatEditableSelection(command);
  }

  function formatEditableSelection(command) {
    if (!state.editMode) return;
    const selection = window.getSelection();
    const node = selection && selection.rangeCount ? selection.anchorNode : null;
    const host = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement).closest('[contenteditable="true"]');
    if (!host) return;
    host.focus();
    document.execCommand(command, false, null);
    host.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function loadFromApi() {
    try {
      setStatus('Chargement de la web app locale...', 'warn');
      const payload = await api('/api/topics');
      setTopics(payload.topics || []);
      state.serverFilters = Array.isArray(payload.filters) ? payload.filters : [];
      if (!state.configFilters.length) state.configFilters = state.serverFilters.slice();
      syncFilterOrder();
      setStatus('Web app locale connectée. Les sujets et documents sont enregistrés sur ce serveur.', 'ok');
      return true;
    } catch (error) {
      console.error(error);
      setStatus('Serveur local indisponible. Lancez la web app avec npm start.', 'warn');
      return false;
    }
  }

  async function api(url, options = {}) {
    const token = currentAccessToken();
    const headers = new Headers(options.headers || {});
    if (token) headers.set('X-Copropro-Token', token);
    const response = await fetch(url, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload && payload.error ? payload.error : `Erreur ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  function setTopics(topics) {
    state.topics = topics.map(norm).sort(topicSort);
    renderAll();
  }

  function norm(topic) {
    const filter = topic.filter || topic.folder || defaultFilter();
    const priority = topic.priority === 'urgent' || topic.status === 'urgent' ? 'urgent' : '';
    return {
      id: topic.id || `topic-${Date.now()}`,
      title: topic.title || 'Nouveau sujet',
      createdAt: topic.createdAt || '',
      filter,
      folder: topic.folder || filter,
      priority,
      status: topicStatus(topic),
      sourceFile: topic.sourceFile || `${topic.id || Date.now()}.md`,
      body: topic.body || 'Contexte à compléter.',
      notes: topic.notes || '',
      documents: Array.isArray(topic.documents) ? topic.documents : [],
      actions: normActions(topic.actions)
    };
  }

  function normActions(actions) {
    return Array.isArray(actions) && actions.length
      ? actions.map((action) => (typeof action === 'string' ? { text: action, done: false } : { text: action.text || 'Nouvelle action à préciser', done: !!action.done }))
      : [{ text: 'Nouvelle action à préciser', done: false }];
  }

  function renderAll() {
    renderFilters();
    renderTopics();
    renderExplorer();
    stats();
    fillNewFilters();
  }

  function filters() {
    let available = unique([...state.configFilters, ...state.serverFilters, ...state.topics.map((topic) => topic.filter), ...state.extraFilters].filter(Boolean));
    if (!available.length) available = [defaultFilter()];
    const configuredOrder = state.configFilters.length ? state.configFilters : state.filterOrder;
    const ordered = configuredOrder.filter((filter) => available.includes(filter));
    const rest = available.filter((filter) => !ordered.includes(filter)).sort((a, b) => a.localeCompare(b, 'fr'));
    return [...ordered, ...rest];
  }

  function defaultFilter() {
    return state.configFilters[0] || state.serverFilters[0] || FALLBACK_FILTER;
  }

  function syncFilterOrder() {
    const list = filters();
    state.filterOrder = list;
    state.configFilters = list;
    state.extraFilters = state.extraFilters.filter((filter) => list.includes(filter));
    persistUi();
  }

  function label(filter) {
    return filter;
  }

  function renderFilters() {
    els['filter-tabs'].innerHTML = '';
    addTab('all', 'Tous les sujets', false);
    filters().forEach((filter) => addTab(filter, label(filter), true));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'filter-add-btn';
    add.textContent = '+ Ajouter un filtre';
    add.onclick = addFilter;
    els['filter-tabs'].appendChild(add);
  }

  function addTab(id, name, managed) {
    const tab = document.createElement('div');
    tab.className = 'tab-btn';
    tab.dataset.filterId = id;
    tab.role = 'button';
    tab.tabIndex = 0;
    tab.draggable = state.editMode && managed;
    if (!managed) tab.dataset.systemFilter = id;
    tab.classList.toggle('active', state.activeFilter === id);
    tab.setAttribute('aria-pressed', String(state.activeFilter === id));

    const span = document.createElement('span');
    span.className = 'filter-name';
    span.textContent = name;
    span.contentEditable = state.editMode && managed;
    span.onkeydown = enterBlur;
    span.onclick = (event) => {
      if (state.editMode && managed) event.stopPropagation();
    };
    span.onblur = async () => {
      if (managed) await renameFilter(id, text(span) || id);
    };
    tab.appendChild(span);

    if (managed) {
      const remove = filterCtrl('×', 'Supprimer ce filtre', () => removeFilter(id), false, 'filter-delete-btn');
      tab.append(remove);
      tab.ondragstart = (event) => dragFilterStart(event, id);
      tab.ondragover = dragFilterOver;
      tab.ondrop = (event) => dropFilter(event, id);
      tab.ondragend = (event) => event.currentTarget.classList.remove('filter-dragging');
    }

    tab.onclick = (event) => {
      if (event.target.closest('.filter-delete-btn') || document.activeElement === span) return;
      state.activeFilter = id;
      renderAll();
    };
    tab.onkeydown = (event) => {
      if (document.activeElement === span) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        state.activeFilter = id;
        renderAll();
      }
    };
    els['filter-tabs'].appendChild(tab);
  }

  function filterCtrl(txt, title, handler, disabled, extra = 'filter-order-btn') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = extra;
    button.title = title;
    button.textContent = txt;
    button.disabled = !!disabled;
    button.onclick = (event) => {
      event.stopPropagation();
      if (!button.disabled) handler();
    };
    return button;
  }

  async function addFilter() {
    const name = (prompt('Nom du nouveau filtre') || '').trim();
    if (!name) return;
    if (filters().includes(name)) {
      state.activeFilter = name;
      return renderAll();
    }
    try {
      const payload = await api('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      state.serverFilters = payload.filters || state.serverFilters;
      state.configFilters = payload.filters || state.configFilters;
      state.activeFilter = name;
      syncFilterOrder();
      setStatus(`Filtre ajouté : ${name}`, 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible de créer le filtre.', 'warn');
    }
  }

  async function removeFilter(filter) {
    if (state.topics.some((topic) => topic.filter === filter)) {
      setStatus('Ce filtre contient des sujets. Déplacez ou supprimez les sujets avant de supprimer le filtre.', 'warn');
      return;
    }
    try {
      const payload = await api(`/api/filters/${encodeURIComponent(filter)}`, { method: 'DELETE' });
      state.serverFilters = payload.filters || [];
      state.configFilters = payload.filters || state.configFilters.filter((item) => item !== filter);
      state.extraFilters = state.extraFilters.filter((item) => item !== filter);
      state.filterOrder = state.filterOrder.filter((item) => item !== filter);
      if (state.activeFilter === filter) state.activeFilter = 'all';
      persistUi();
      setStatus(`Filtre supprimé : ${filter}`, 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible de supprimer ce filtre.', 'warn');
    }
  }

  async function renameFilter(oldFilter, next) {
    if (!next || next === oldFilter) return renderAll();
    if (filters().includes(next)) {
      setStatus('Un filtre porte déjà ce nom.', 'warn');
      return renderAll();
    }
    try {
      const payload = await api(`/api/filters/${encodeURIComponent(oldFilter)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next })
      });
      setTopics(payload.topics || state.topics);
      state.serverFilters = payload.filters || state.serverFilters.map((filter) => (filter === oldFilter ? next : filter));
      state.configFilters = payload.filters || state.configFilters.map((filter) => (filter === oldFilter ? next : filter));
      state.extraFilters = state.extraFilters.map((filter) => (filter === oldFilter ? next : filter));
      state.filterOrder = state.filterOrder.map((filter) => (filter === oldFilter ? next : filter));
      if (state.activeFilter === oldFilter) state.activeFilter = next;
      persistUi();
      setStatus(`Filtre renommé : ${next}`, 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible de renommer le filtre.', 'warn');
      renderAll();
    }
  }

  function dragFilterStart(event, filter) {
    if (!state.editMode) {
      event.preventDefault();
      return;
    }
    state.dragFilter = filter;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', filter);
    event.currentTarget.classList.add('filter-dragging');
  }

  function dragFilterOver(event) {
    if (!state.editMode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function dropFilter(event, target) {
    event.preventDefault();
    const source = state.dragFilter || event.dataTransfer.getData('text/plain');
    if (!source || source === target) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientX < rect.left + rect.width / 2;
    const list = filters();
    const from = list.indexOf(source);
    let to = list.indexOf(target) + (before ? 0 : 1);
    if (from < 0 || to < 0) return;
    list.splice(from, 1);
    if (from < to) to -= 1;
    list.splice(to, 0, source);
    state.filterOrder = list;
    state.configFilters = list;
    state.dragFilter = null;
    saveConfigDebounced();
    renderAll();
  }

  function visibleTopics() {
    return state.topics.filter((topic) => {
      const currentStatus = status(topic);
      const filterOk = state.activeFilter === 'all' || topic.filter === state.activeFilter;
      const statOk =
        state.statFilter === 'active'
          ? currentStatus !== 'resolved'
        : state.statFilter === 'urgent'
            ? currentStatus === 'urgent'
            : state.statFilter === 'todo'
              ? currentStatus === 'todo'
              : state.statFilter === 'partial'
                ? currentStatus === 'partial'
                : state.statFilter === 'resolved'
                  ? currentStatus === 'resolved'
                  : true;
      const haystack = `${topic.title} ${topic.filter} ${topic.body} ${topic.notes} ${topic.documents.map((document) => `${document.label} ${document.href}`).join(' ')}`.toLowerCase();
      return filterOk && statOk && (!state.search || haystack.includes(state.search));
    });
  }

  function renderTopics() {
    els['topics-section'].innerHTML = '';
    const grouped = new Map();
    visibleTopics().forEach((topic) => {
      if (!grouped.has(topic.filter)) grouped.set(topic.filter, []);
      grouped.get(topic.filter).push(topic);
    });
    if (!grouped.size) {
      const title = state.search ? 'Aucun sujet ne correspond à la recherche' : 'Aucun sujet trouvé';
      const hint = state.search ? 'Essayez un autre mot-clé ou effacez la recherche.' : 'Modifiez vos critères ou créez un sujet.';
      els['topics-section'].innerHTML = `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(hint)}</p></div>`;
      return;
    }
    grouped.forEach((list, filter) => {
      const group = document.createElement('div');
      group.className = 'category-group';
      group.innerHTML = `<h2 class="category-title">${esc(label(filter))}</h2>`;
      list.forEach((topic) => group.appendChild(card(topic)));
      els['topics-section'].appendChild(group);
    });
    stats();
  }

  function card(topic) {
    const container = document.createElement('article');
    const currentStatus = status(topic);
    container.className = `topic-card ${currentStatus === 'urgent' ? 'highlight-urgent' : 'highlight-warning'}`;
    container.classList.toggle('is-partial', currentStatus === 'partial');
    container.classList.toggle('is-resolved', currentStatus === 'resolved');
    container.innerHTML = `<div class="card-header"><div class="card-title-group"><span class="location-tag"></span><h3 data-edit="title"></h3></div><div class="card-meta-badges"><span class="badge ${badgeClass(currentStatus)}">${badgeText(currentStatus)}</span></div></div>`;

    const location = container.querySelector('.location-tag');
    const heading = container.querySelector('h3');
    const titleGroup = container.querySelector('.card-title-group');
    const metaBadges = container.querySelector('.card-meta-badges');
    location.textContent = label(topic.filter);
    heading.textContent = topic.title;
    heading.contentEditable = state.editMode;
    heading.onkeydown = enterBlur;
    heading.onblur = () => update(topic, { title: text(heading) || topic.title });
    if (topic.createdAt) {
      const date = document.createElement('span');
      date.className = 'topic-created-date';
      date.replaceChildren(iconElement('calendar'), document.createTextNode(formatDate(topic.createdAt)));
      titleGroup.appendChild(date);
    }
    if (state.editMode) {
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'topic-delete-btn';
      deleteButton.textContent = 'Supprimer';
      deleteButton.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      deleteButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteTopic(topic);
      };
      metaBadges.appendChild(deleteButton);
    }

    const body = document.createElement('div');
    body.className = 'card-body markdown-body';
    body.dataset.edit = 'body';
    body.innerHTML = mdHtml(topic.body);
    body.contentEditable = state.editMode;
    body.onblur = () => update(topic, { body: htmlMd(body) });

    const action = document.createElement('div');
    action.className = 'action-box';
    const actionTitle = document.createElement('div');
    actionTitle.className = 'action-box-title';
    setIconText(actionTitle, 'action', 'Proposition d\'Action');
    action.appendChild(actionTitle);
    const list = document.createElement('div');
    list.className = 'action-box-text';
    topic.actions.forEach((item, index) => list.appendChild(actionRow(topic, item, index)));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-ctrl action-add-point-btn';
    add.textContent = '+ Ajouter une action';
    add.onclick = () => {
      topic.actions.push({ text: 'Nouvelle action à préciser', done: false });
      saveTopic(topic).then(renderAll);
    };
    action.append(list, add);

    const notes = document.createElement('div');
    notes.className = 'notes-block';
    const notesLabel = document.createElement('span');
    notesLabel.className = 'notes-label';
    setIconText(notesLabel, 'note', 'Notes de Suivi');
    notes.appendChild(notesLabel);
    const notesList = document.createElement('div');
    notesList.className = 'notes-list';
    parseNoteEntries(topic).forEach((note, index) => notesList.appendChild(noteRow(topic, note, index)));
    if (!notesList.children.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-empty';
      empty.textContent = state.editMode ? 'Aucune note de suivi. Utilisez le bouton pour en ajouter une.' : 'Aucune note de suivi.';
      notesList.appendChild(empty);
    }
    const addNote = document.createElement('button');
    addNote.type = 'button';
    addNote.className = 'btn-ctrl action-add-point-btn note-add-point-btn';
    addNote.textContent = '+ Ajouter une note';
    addNote.onclick = () => {
      const entries = parseNoteEntries(topic);
      entries.push({ date: todayIso(), text: 'Nouvelle note de suivi à préciser' });
      topic.notes = serializeNoteEntries(entries);
      saveTopic(topic).then(renderAll);
    };
    notes.append(notesList, addNote);

    container.append(body, action, notes);
    if (state.editMode || topic.documents.length) container.appendChild(attachments(topic));
    return container;
  }

  function actionRow(topic, action, index) {
    const row = document.createElement('div');
    row.className = 'action-point-row';
    const checkbox = document.createElement('input');
    const textId = `action-text-${topic.id}-${index}`;
    checkbox.type = 'checkbox';
    checkbox.className = 'action-point-checkbox';
    checkbox.checked = !!action.done;
    checkbox.setAttribute('aria-labelledby', textId);
    checkbox.onchange = () => {
      topic.actions[index].done = checkbox.checked;
      saveTopic(topic).then(renderAll);
    };
    const span = document.createElement('span');
    span.id = textId;
    span.className = 'action-point-text';
    span.textContent = action.text;
    span.contentEditable = state.editMode;
    span.onkeydown = enterBlur;
    span.onblur = () => {
      topic.actions[index].text = text(span) || 'Nouvelle action à préciser';
      saveTopic(topic).then(renderAll);
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'action-point-remove-btn';
    remove.textContent = '×';
    remove.onclick = () => {
      if (!state.editMode) return;
      topic.actions.splice(index, 1);
      if (!topic.actions.length) topic.actions.push({ text: 'Nouvelle action à préciser', done: false });
      saveTopic(topic).then(renderAll);
    };
    row.append(checkbox, span, remove);
    return row;
  }

  function noteRow(topic, note, index) {
    const row = document.createElement('div');
    row.className = 'action-point-row note-point-row';
    const date = document.createElement('span');
    date.className = 'note-point-date';
    date.textContent = formatDate(note.date);
    const span = document.createElement('span');
    span.className = 'action-point-text note-point-text';
    span.textContent = note.text;
    span.contentEditable = state.editMode;
    span.onkeydown = enterBlur;
    span.onblur = () => {
      const entries = parseNoteEntries(topic);
      entries[index] = { ...entries[index], text: text(span) || 'Nouvelle note de suivi à préciser' };
      topic.notes = serializeNoteEntries(entries);
      saveTopic(topic).then(renderAll);
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'action-point-remove-btn';
    remove.textContent = '×';
    remove.onclick = () => {
      if (!state.editMode) return;
      const entries = parseNoteEntries(topic);
      entries.splice(index, 1);
      topic.notes = serializeNoteEntries(entries);
      saveTopic(topic).then(renderAll);
    };
    row.append(date, span, remove);
    return row;
  }

  function parseNoteEntries(topic) {
    const fallbackDate = topic.createdAt || todayIso();
    const raw = String(topic.notes || '').trim();
    if (!raw) return [];
    const blocks = raw.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return blocks.map((block) => {
      const normalized = block.replace(/^\s*[-*]\s+/, '');
      const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+[—-]\s+([\s\S]+)$/);
      return match
        ? { date: match[1], text: match[2].trim() }
        : { date: fallbackDate, text: normalized };
    });
  }

  function serializeNoteEntries(entries) {
    return entries
      .map((entry) => ({ date: entry.date || todayIso(), text: text(entry.text) }))
      .filter((entry) => entry.text)
      .map((entry) => `- ${entry.date} — ${entry.text}`)
      .join('\n\n');
  }

  function attachments(topic) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-attachments';
    const panel = document.createElement('div');
    panel.className = 'uploaded-documents-panel';
    const header = document.createElement('div');
    header.className = 'uploaded-documents-header';
    const title = document.createElement('span');
    title.className = 'uploaded-documents-title';
    setIconText(title, 'paperclip', 'Documents associés');
    header.appendChild(title);

    if (state.editMode) {
      const add = document.createElement('label');
      add.className = 'attachment-upload-btn';
      add.textContent = '+ Ajouter une pièce jointe';
      const input = document.createElement('input');
      input.type = 'file';
      input.className = 'attachment-file-input';
      input.multiple = true;
      input.onchange = async (event) => {
        await addAttachments(topic, Array.from(event.target.files || []));
        input.value = '';
      };
      add.appendChild(input);
      header.appendChild(add);
    }

    const list = document.createElement('div');
    list.className = 'uploaded-documents-list';
    if (topic.documents.length) topic.documents.forEach((document, index) => list.appendChild(docLink(document, topic, index)));
    else {
      const empty = document.createElement('span');
      empty.className = 'uploaded-documents-empty';
      empty.textContent = state.editMode ? 'Aucune pièce jointe. Utilisez le bouton pour en ajouter une.' : 'Aucun document associé.';
      list.appendChild(empty);
    }
    panel.append(header, list);
    wrapper.appendChild(panel);
    return wrapper;
  }

  function docLink(documentData, topic, index) {
    const item = document.createElement('div');
    item.className = 'uploaded-document-item';
    const link = document.createElement('a');
    link.className = 'attachment-btn uploaded-document-link';
    link.href = documentHref(documentData.href || '#');
    link.target = '_blank';
    link.rel = 'noopener';
    link.replaceChildren(
      iconElement(documentData.type === 'image' ? 'image' : /\.(eml|msg)$/i.test(documentData.href || '') ? 'mail' : 'file'),
      document.createTextNode(documentData.label || documentData.href)
    );
    if (documentData.type === 'image') {
      link.onclick = (event) => {
        event.preventDefault();
        els['lightbox-img'].src = documentHref(documentData.href);
        els['lightbox-title'].textContent = documentData.label || 'Image';
        els['lightbox-desc'].textContent = documentData.description || documentData.href;
        els.lightbox.showModal();
      };
    }
    item.appendChild(link);
    if (topic && state.editMode) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'attachment-remove-btn';
      remove.title = 'Retirer cette pièce jointe';
      remove.textContent = '×';
      remove.onclick = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await removeAttachment(topic, index);
      };
      item.appendChild(remove);
    }
    return item;
  }

  async function addAttachments(topic, files) {
    if (!files.length) return;
    const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      setStatus(`Fichier trop volumineux : ${oversized.name}. Taille maximale : ${formatBytes(MAX_UPLOAD_BYTES)}.`, 'warn');
      return;
    }
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    try {
      const payload = await api(`/api/topics/${encodeURIComponent(topic.id)}/attachments`, {
        method: 'POST',
        body: formData
      });
      replaceTopic(payload.topic);
      setStatus('Pièce jointe enregistrée dans Documents.', 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible d’ajouter la pièce jointe.', 'warn');
    }
  }

  async function removeAttachment(topic, index) {
    try {
      const payload = await api(`/api/topics/${encodeURIComponent(topic.id)}/documents/${index}`, { method: 'DELETE' });
      replaceTopic(payload.topic);
      setStatus('Pièce jointe retirée du sujet. Le fichier reste dans Documents.', 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible de retirer cette pièce jointe.', 'warn');
    }
  }

  function renderExplorer() {
    els['document-explorer-tree'].innerHTML = '';
    const docs = visibleTopics().flatMap((topic) => topic.documents.map((documentData) => ({ topic, documentData })));
    if (!docs.length) {
      els['document-explorer-tree'].textContent = state.search ? 'Aucun document associé aux résultats.' : 'Aucun document associé.';
      return;
    }

    const currentYear = String(new Date().getFullYear());
    const years = unique([currentYear, ...docs.map(({ topic, documentData }) => documentYear(documentData, topic))])
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a, 'fr', { numeric: true }));

    years.forEach((year) => {
      const yearDocs = docs.filter(({ topic, documentData }) => documentYear(documentData, topic) === year);
      const yearFolder = treeFolder(year, 'folder');
      const yearContent = yearFolder.querySelector('.tree-folder-content');

      filters().forEach((filter) => {
        const related = yearDocs.filter((item) => item.topic.filter === filter && !isArchivedDocument(item.documentData, docs));
        if (!related.length) return;
        const filterFolder = treeFolder(label(filter), 'folder');
        const filterContent = filterFolder.querySelector('.tree-folder-content');
        related.forEach(({ documentData }) => filterContent.appendChild(docLink(documentData)));
        yearContent.appendChild(filterFolder);
      });

      const archived = yearDocs.filter((item) => isArchivedDocument(item.documentData, docs));
      if (archived.length) {
        const archiveFolder = treeFolder('Archives', 'archive');
        const archiveContent = archiveFolder.querySelector('.tree-folder-content');
        archived.forEach(({ documentData }) => archiveContent.appendChild(docLink(documentData)));
        yearContent.appendChild(archiveFolder);
      }

      if (!yearContent.children.length) {
        const empty = document.createElement('span');
        empty.className = 'tree-empty';
        empty.textContent = 'Aucun document pour cette année.';
        yearContent.appendChild(empty);
      }

      els['document-explorer-tree'].appendChild(yearFolder);
    });
  }

  function treeFolder(title, iconName = 'folder') {
    const box = document.createElement('div');
    box.className = 'tree-folder';
    box.innerHTML = `<div class="tree-folder-header"><span class="folder-arrow">${iconHtml('chevron-down', 'ui-icon tree-chevron')}</span>${iconHtml(iconName, 'ui-icon tree-folder-icon')}<span>${esc(title)}</span></div><div class="tree-folder-content"></div>`;
    const content = box.querySelector('.tree-folder-content');
    box.querySelector('.tree-folder-header').onclick = () => {
      const hide = content.style.display !== 'none';
      content.style.display = hide ? 'none' : 'flex';
      box.querySelector('.folder-arrow').innerHTML = iconHtml(hide ? 'chevron-right' : 'chevron-down', 'ui-icon tree-chevron');
    };
    return box;
  }

  function documentYear(documentData, topic) {
    const hrefYear = String(documentData.href || '').match(/^Documents\/(\d{4})\//);
    if (hrefYear) return hrefYear[1];
    const topicYear = String(topic.createdAt || '').match(/^(\d{4})-/);
    return topicYear ? topicYear[1] : String(new Date().getFullYear());
  }

  function isArchivedDocument(documentData, docs) {
    const href = documentData.href || '';
    if (!href) return false;
    return !docs.some((item) => item.documentData.href === href && status(item.topic) !== 'resolved');
  }

  function stats() {
    const counts = { active: 0, urgent: 0, todo: 0, partial: 0, resolved: 0 };
    state.topics.forEach((topic) => {
      const currentStatus = status(topic);
      if (currentStatus === 'resolved') counts.resolved += 1;
      else {
        counts.active += 1;
        if (currentStatus === 'urgent') counts.urgent += 1;
        if (currentStatus === 'partial') counts.partial += 1;
        if (currentStatus === 'todo') counts.todo += 1;
      }
    });
    [
      ['stat-total', counts.active],
      ['stat-urgent', counts.urgent],
      ['stat-warning', counts.todo],
      ['stat-info', counts.partial],
      ['stat-resolved', counts.resolved]
    ].forEach(([id, value]) => {
      document.getElementById(id).textContent = value;
    });
    document.querySelectorAll('.stat-card').forEach((card) => {
      const active = card.dataset.statFilter === state.statFilter;
      card.classList.toggle('stat-filter-active', active);
      card.setAttribute('aria-pressed', String(active));
    });
  }

  function status(topic) {
    return topicStatus(topic);
  }

  function topicStatus(topic) {
    const actions = Array.isArray(topic.actions) ? topic.actions : [];
    const done = actions.filter((action) => action.done).length;
    if (done && done === actions.length) return 'resolved';
    if (isUrgentTopic(topic)) return 'urgent';
    if (done) return 'partial';
    if (topic.status === 'resolved' || topic.status === 'partial') return 'todo';
    if (TOPIC_STATUSES.has(topic.status)) return topic.status;
    return 'todo';
  }

  function isUrgentTopic(topic) {
    return topic.priority === 'urgent' || topic.status === 'urgent';
  }

  function badgeClass(currentStatus) {
    return currentStatus === 'resolved' ? 'success' : currentStatus === 'partial' ? 'info' : currentStatus === 'urgent' ? 'urgent' : 'warning';
  }

  function badgeText(currentStatus) {
    return currentStatus === 'resolved' ? 'Traité' : currentStatus === 'partial' ? 'Partiellement traité' : currentStatus === 'urgent' ? 'Urgent / Critique' : 'À Traiter';
  }

  async function update(topic, patch) {
    if (state.deletingTopicIds.has(topic.id)) return;
    Object.assign(topic, patch);
    await saveTopic(topic);
    renderAll();
  }

  async function saveTopic(topic) {
    if (state.deletingTopicIds.has(topic.id)) return;
    topic.status = status(topic);
    try {
      const payload = await api(`/api/topics/${encodeURIComponent(topic.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(topic)
      });
      replaceTopic(payload.topic);
      setStatus(`Markdown mis à jour : ${payload.topic.sourceFile}`, 'ok');
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible d’écrire le fichier Markdown.', 'warn');
    }
  }

  async function deleteTopic(topic) {
    const confirmed = window.confirm(`Supprimer le sujet "${topic.title}" ?`);
    if (!confirmed) return;
    state.deletingTopicIds.add(topic.id);
    try {
      await api(`/api/topics/${encodeURIComponent(topic.id)}`, { method: 'DELETE' });
      state.topics = state.topics.filter((item) => item.id !== topic.id);
      setStatus(`Sujet supprimé : ${topic.title}`, 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      const message = String(error.message || '');
      const restartHint = message.toLowerCase().includes('methode non autorisee') || message.toLowerCase().includes('méthode non autorisée')
        ? 'Suppression indisponible : redémarrez la web app pour charger la nouvelle version du serveur.'
        : message || 'Impossible de supprimer ce sujet.';
      setStatus(restartHint, 'warn');
    } finally {
      state.deletingTopicIds.delete(topic.id);
    }
  }

  function replaceTopic(topic) {
    const normalized = norm(topic);
    const index = state.topics.findIndex((item) => item.id === normalized.id);
    if (index >= 0) state.topics.splice(index, 1, normalized);
    else state.topics.push(normalized);
    state.topics.sort(topicSort);
  }

  function topicSort(a, b) {
    const dateDiff = dateRank(b.createdAt) - dateRank(a.createdAt);
    if (dateDiff) return dateDiff;
    const numberDiff = topicNumber(b) - topicNumber(a);
    if (numberDiff) return numberDiff;
    return a.title.localeCompare(b.title, 'fr', { numeric: true });
  }

  function dateRank(value) {
    const time = Date.parse(`${value || ''}T00:00:00`);
    return Number.isNaN(time) ? 0 : time;
  }

  function topicNumber(topic) {
    const id = String(topic.id || '');
    if (/^\d{4}$/.test(id)) return Number(id);
    const sourceMatch = String(topic.sourceFile || '').match(/^(\d{4})[-_]/);
    if (sourceMatch) return Number(sourceMatch[1]);
    const titleMatch = String(topic.title || '').match(/^(\d{2,})\s*-\s+/);
    return titleMatch ? Number(titleMatch[1]) : 0;
  }

  function mdHtml(markdown) {
    let html = '';
    let ul = false;
    const close = () => {
      if (ul) {
        html += '</ul>';
        ul = false;
      }
    };
    String(markdown || '')
      .split('\n')
      .forEach((line) => {
        const value = line.trim();
        if (!value) {
          close();
          return;
        }
        if (value.startsWith('- ')) {
          if (!ul) {
            html += '<ul>';
            ul = true;
          }
          html += `<li>${inline(value.slice(2))}</li>`;
        } else {
          close();
          html += `<p>${inline(value)}</p>`;
        }
      });
    close();
    return html || '<p></p>';
  }

  function inline(value) {
    return esc(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function htmlMd(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script,style').forEach((node) => node.remove());
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      const content = Array.from(node.childNodes).map(walk).join('');
      if (tag === 'strong' || tag === 'b') return `**${content.trim()}**`;
      if (tag === 'em' || tag === 'i') return `*${content.trim()}*`;
      if (tag === 'li') return `- ${content.trim()}\n`;
      if (tag === 'p' || tag === 'div') return `${content.trim()}\n\n`;
      if (tag === 'br') return '\n';
      return content;
    }
    return Array.from(clone.childNodes).map(walk).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function fillNewFilters() {
    els['new-topic-filter'].innerHTML = '';
    filters().forEach((filter) => {
      const option = document.createElement('option');
      option.value = filter;
      option.textContent = label(filter);
      els['new-topic-filter'].appendChild(option);
    });
  }

  function addNewActionInput(value) {
    const row = document.createElement('div');
    row.className = 'new-topic-action-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'new-topic-action-input';
    input.placeholder = 'Action à réaliser';
    input.value = value || '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'new-topic-action-remove';
    remove.title = 'Supprimer cette proposition';
    remove.textContent = '×';
    remove.onclick = () => {
      row.remove();
      if (!els['new-topic-actions-list'].querySelector('.new-topic-action-row')) addNewActionInput('');
    };
    row.append(input, remove);
    els['new-topic-actions-list'].appendChild(row);
    return input;
  }

  function getNewActions() {
    const values = Array.from(els['new-topic-actions-list'].querySelectorAll('.new-topic-action-input')).map((input) => text(input)).filter(Boolean);
    return (values.length ? values : ['Nouvelle action à préciser']).map((value) => ({ text: value, done: false }));
  }

  function formatTextareaSelection(kind) {
    const area = els['new-topic-body'];
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const value = area.value;
    const selected = value.slice(start, end) || 'texte';
    let next = selected;
    let cursorStart = start;
    let cursorEnd = end;
    if (kind === 'bold') {
      next = `**${selected}**`;
      cursorStart = start + 2;
      cursorEnd = start + 2 + selected.length;
    }
    if (kind === 'list') {
      next = selected.split('\n').map((line) => (line.trim() ? `- ${line.replace(/^-\s+/, '')}` : line)).join('\n');
      cursorEnd = start + next.length;
    }
    area.value = value.slice(0, start) + next + value.slice(end);
    area.focus();
    area.setSelectionRange(cursorStart, cursorEnd);
  }

  function openNew() {
    fillNewFilters();
    els['new-topic-form'].reset();
    els['new-topic-actions-list'].innerHTML = '';
    addNewActionInput('');
    els['new-topic-dialog'].showModal();
    setTimeout(() => els['new-topic-title'].focus(), 0);
  }

  async function createNew(event) {
    event.preventDefault();
    const filter = els['new-topic-filter'].value || defaultFilter();
    try {
      const payload = await api('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter,
          title: text(els['new-topic-title']) || 'Nouveau sujet',
          status: TOPIC_STATUSES.has(els['new-topic-status'].value) ? els['new-topic-status'].value : 'todo',
          body: text(els['new-topic-body']) || 'Contexte à compléter.',
          actions: getNewActions()
        })
      });
      replaceTopic(payload.topic);
      state.serverFilters = payload.filters || state.serverFilters;
      state.configFilters = payload.filters || state.configFilters;
      syncFilterOrder();
      els['new-topic-dialog'].close();
      setStatus(`Sujet créé : ${payload.topic.sourceFile}`, 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Impossible de créer le sujet.', 'warn');
    }
  }

  function setStatus(message, kind = '') {
    els['content-loader-status'].textContent = message;
    els['content-loader-status'].className = `content-loader-status ${kind}`.trim();
  }

  function initAccessToken() {
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token') || url.searchParams.get('access_token');
      if (!token) return;
      sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
      url.searchParams.delete('token');
      url.searchParams.delete('access_token');
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // L'app locale reste utilisable sans jeton.
    }
  }

  function currentAccessToken() {
    try {
      return sessionStorage.getItem(ACCESS_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function documentHref(href) {
    const token = currentAccessToken();
    if (!token || !String(href || '').startsWith('Documents/')) return href || '#';
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}token=${encodeURIComponent(token)}`;
  }

  function enterBlur(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  function text(element) {
    if (element == null) return '';
    return String(element.value ?? element.textContent ?? element).replace(/\s+/g, ' ').trim();
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${Math.floor(bytes / 1024 / 1024)} Mo`;
    if (bytes >= 1024) return `${Math.floor(bytes / 1024)} Ko`;
    return `${bytes} octets`;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Lecture de l’image impossible.'));
      reader.readAsDataURL(file);
    });
  }

  function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
})();
