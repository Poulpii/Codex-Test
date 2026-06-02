(function clientApp() {
  const UI_KEY = 'canopee_ui_state_v1';
  const PHOTO_PREVIEW_KEY = 'canopee_building_photo_preview_v1';
  const DEFAULT_FILTER = 'Général';
  const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
  const BUILDING = {
    Administratif: 'general',
    'Bâtiment A (Rue)': 'bat-a',
    'Bâtiment B (Cour)': 'bat-b',
    [DEFAULT_FILTER]: 'general'
  };
  const state = {
    topics: [],
    serverFilters: [],
    activeFilter: 'all',
    statFilter: 'active',
    search: '',
    editMode: false,
    filterLabels: {},
    filterOrder: [],
    extraFilters: [],
    buildingPhotoUrl: '',
    deletingTopicIds: new Set()
  };
  const els = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bind();
    restoreUi();
    bindEvents();
    await loadFromApi();
    renderAll();
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
      'new-topic-severity',
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
    els.logo = document.querySelector('.brand-logo');
    els.headerRow = document.querySelector('.header-sticky-row');
    els.logoUploadInput = document.createElement('input');
    els.logoUploadInput.type = 'file';
    els.logoUploadInput.accept = 'image/*';
    els.logoUploadInput.className = 'brand-photo-input';
    document.body.appendChild(els.logoUploadInput);
  }

  function bindEvents() {
    els['edit-toggle-btn'].onclick = () => setEditMode(!state.editMode);
    bindHeaderFormat('header-bold-btn', 'bold');
    bindHeaderFormat('header-list-btn', 'insertUnorderedList');
    els['theme-toggle-btn'].onclick = toggleTheme;
    els['search-input'].oninput = (event) => {
      state.search = event.target.value.toLowerCase().trim();
      renderTopics();
    };
    document.querySelectorAll('.stat-card').forEach((card) => {
      card.onclick = () => {
        state.statFilter = card.dataset.statFilter;
        renderAll();
      };
    });
    els['app-main-title'].oninput = saveUi;
    els['app-main-subtitle'].oninput = saveUi;
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
    els.logo.onclick = () => {
      if (state.editMode) els.logoUploadInput.click();
    };
    els.logoUploadInput.onchange = async (event) => {
      await uploadBuildingPhoto(event.target.files && event.target.files[0]);
      els.logoUploadInput.value = '';
    };
    setupTopChromeObserver();
  }

  function restoreUi() {
    try {
      const ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    if (ui.title) els['app-main-title'].textContent = ui.title;
      if (ui.subtitle) els['app-main-subtitle'].textContent = ui.subtitle;
      state.filterLabels = ui.filterLabels || {};
      state.filterOrder = Array.isArray(ui.filterOrder) ? ui.filterOrder : [];
      state.extraFilters = Array.isArray(ui.extraFilters) ? ui.extraFilters : [];
      state.buildingPhotoUrl = localStorage.getItem(PHOTO_PREVIEW_KEY) || '';
      document.body.classList.toggle('light-theme', ui.theme !== 'dark');
    } catch {
      document.body.classList.add('light-theme');
    }
    updateLogo();
    initTheme();
  }

  function persistUi() {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        title: text(els['app-main-title']) || 'Canopée',
        subtitle: text(els['app-main-subtitle']),
        theme: document.body.classList.contains('light-theme') ? 'light' : 'dark',
        filterLabels: state.filterLabels,
        filterOrder: state.filterOrder,
        extraFilters: state.extraFilters
      })
    );
  }

  function saveUi() {
    updateLogo();
    updateTopChromeSpacing();
    persistUi();
  }

  function updateLogo() {
    els.logo.innerHTML = '';
    els.logo.title = state.editMode ? 'Changer la photo de l’immeuble' : '';
    if (state.buildingPhotoUrl) {
      const image = document.createElement('img');
      image.src = state.buildingPhotoUrl;
      image.alt = 'Photo de l’immeuble';
      els.logo.appendChild(image);
      els.logo.classList.add('has-photo');
      return;
    }
    els.logo.classList.remove('has-photo');
    els.logo.innerHTML = '<span class="brand-logo-placeholder" aria-hidden="true"></span>';
  }

  function initTheme() {
    els['theme-toggle-btn'].textContent = document.body.classList.contains('light-theme') ? '🌙 Thème Sombre' : '☀️ Thème Clair';
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
    els['edit-toggle-btn'].textContent = value ? '💾 Quitter l\'édition' : '🛠️ Éditer le texte';
    [els['app-main-title'], els['app-main-subtitle']].forEach((element) => {
      element.contentEditable = value;
    });
    renderAll();
    updateLogo();
    updateTopChromeSpacing();
  }

  function setupTopChromeObserver() {
    window.addEventListener('resize', updateTopChromeSpacing);
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(updateTopChromeSpacing);
      if (els.headerRow) observer.observe(els.headerRow);
      if (els['edit-banner']) observer.observe(els['edit-banner']);
    }
    updateTopChromeSpacing();
  }

  function updateTopChromeSpacing() {
    requestAnimationFrame(() => {
      const headerHeight = els.headerRow ? Math.ceil(els.headerRow.getBoundingClientRect().height) : 72;
      const bannerHeight = els['edit-banner'] && els['edit-banner'].classList.contains('active')
        ? Math.ceil(els['edit-banner'].getBoundingClientRect().height)
        : 0;
      document.documentElement.style.setProperty('--fixed-header-height', `${headerHeight}px`);
      document.documentElement.style.setProperty('--edit-banner-height', `${bannerHeight}px`);
    });
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
      await loadBuildingPhoto();
      const payload = await api('/api/topics');
      setTopics(payload.topics || []);
      state.serverFilters = Array.isArray(payload.filters) ? payload.filters : [];
      syncFilterOrder();
      setStatus('Web app locale connectée. Les sujets et documents sont enregistrés sur ce serveur.', 'ok');
      return true;
    } catch (error) {
      console.error(error);
      setStatus('Serveur local indisponible. Lancez la web app avec npm start.', 'warn');
      return false;
    }
  }

  async function loadBuildingPhoto() {
    try {
      const payload = await api('/api/building-photo');
      if (payload.url) {
        state.buildingPhotoUrl = `${payload.url}?v=${Date.now()}`;
        localStorage.removeItem(PHOTO_PREVIEW_KEY);
        updateLogo();
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function uploadBuildingPhoto(file) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus(`Image trop volumineuse. Taille maximale : ${formatBytes(MAX_UPLOAD_BYTES)}.`, 'warn');
      return;
    }
    try {
      const previewDataUrl = await fileToDataUrl(file);
      state.buildingPhotoUrl = previewDataUrl;
      updateLogo();
      try {
        localStorage.setItem(PHOTO_PREVIEW_KEY, previewDataUrl);
      } catch {
        localStorage.removeItem(PHOTO_PREVIEW_KEY);
      }
      setStatus('Photo affichée dans le carré. Enregistrement dans assets...', 'warn');

      const formData = new FormData();
      formData.append('photo', file);
      const payload = await api('/api/building-photo', {
        method: 'POST',
        body: formData
      });
      if (payload.url) {
        state.buildingPhotoUrl = `${payload.url}?v=${Date.now()}`;
        localStorage.removeItem(PHOTO_PREVIEW_KEY);
        updateLogo();
      }
      setStatus('Photo de l’immeuble enregistrée dans assets.', 'ok');
    } catch (error) {
      console.error(error);
      updateLogo();
      const normalizedMessage = String(error.message || '').toLowerCase();
      const restartHint = normalizedMessage.includes('methode non autorisee') || normalizedMessage.includes('méthode non autorisée')
        ? 'Photo affichée en aperçu. Redémarrez la web app pour l’enregistrer dans assets.'
        : error.message || 'Photo affichée en aperçu, mais impossible de l’enregistrer dans assets.';
      setStatus(restartHint, 'warn');
    }
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload && payload.error ? payload.error : `Erreur ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  function setTopics(topics) {
    state.topics = topics.map(norm).sort((a, b) => a.title.localeCompare(b.title, 'fr', { numeric: true }));
    renderAll();
  }

  function norm(topic) {
    const filter = topic.filter || topic.folder || DEFAULT_FILTER;
    return {
      id: topic.id || `topic-${Date.now()}`,
      title: topic.title || 'Nouveau sujet',
      createdAt: topic.createdAt || '',
      filter,
      folder: topic.folder || filter,
      building: topic.building || BUILDING[filter] || 'general',
      location: topic.location || filter,
      severity: topic.severity === 'urgent' ? 'urgent' : 'warning',
      status: topic.status || 'todo',
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
    updateTopChromeSpacing();
  }

  function filters() {
    let available = Array.from(new Set([...state.serverFilters, ...state.topics.map((topic) => topic.filter), ...state.extraFilters])).filter(Boolean);
    if (!available.length) available = [DEFAULT_FILTER];
    const ordered = state.filterOrder.filter((filter) => available.includes(filter));
    const rest = available.filter((filter) => !ordered.includes(filter)).sort((a, b) => a.localeCompare(b, 'fr'));
    return [...ordered, ...rest];
  }

  function syncFilterOrder() {
    const list = filters();
    state.filterOrder = list;
    state.extraFilters = state.extraFilters.filter((filter) => list.includes(filter));
    persistUi();
  }

  function label(filter) {
    return state.filterLabels[filter] || filter;
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
      state.extraFilters = state.extraFilters.map((filter) => (filter === oldFilter ? next : filter));
      state.filterOrder = state.filterOrder.map((filter) => (filter === oldFilter ? next : filter));
      if (state.activeFilter === oldFilter) state.activeFilter = next;
      delete state.filterLabels[oldFilter];
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
    state.dragFilter = null;
    persistUi();
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
            ? topic.severity === 'urgent' && currentStatus !== 'resolved'
            : state.statFilter === 'todo'
              ? currentStatus === 'todo'
              : state.statFilter === 'partial'
                ? currentStatus === 'partial'
                : state.statFilter === 'resolved'
                  ? currentStatus === 'resolved'
                  : true;
      const haystack = `${topic.title} ${topic.location} ${topic.body} ${topic.notes} ${topic.documents.map((document) => `${document.label} ${document.href}`).join(' ')}`.toLowerCase();
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
      els['topics-section'].innerHTML = '<div class="empty-state"><h3>Aucun sujet trouvé</h3><p>Modifiez vos critères ou créez un sujet.</p></div>';
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
    container.className = `topic-card ${topic.severity === 'urgent' ? 'highlight-urgent' : 'highlight-warning'}`;
    container.classList.toggle('is-partial', currentStatus === 'partial');
    container.classList.toggle('is-resolved', currentStatus === 'resolved');
    container.innerHTML = `<div class="card-header"><div class="card-title-group"><span class="location-tag"></span><h3 data-edit="title"></h3></div><div class="card-meta-badges"><span class="badge ${badgeClass(currentStatus, topic.severity)}">${badgeText(currentStatus, topic.severity)}</span></div></div>`;

    const location = container.querySelector('.location-tag');
    const heading = container.querySelector('h3');
    const titleGroup = container.querySelector('.card-title-group');
    const metaBadges = container.querySelector('.card-meta-badges');
    location.textContent = topic.location;
    heading.textContent = topic.title;
    heading.contentEditable = state.editMode;
    heading.onkeydown = enterBlur;
    heading.onblur = () => update(topic, { title: text(heading) || topic.title });
    if (topic.createdAt) {
      const date = document.createElement('span');
      date.className = 'topic-created-date';
      date.textContent = formatDate(topic.createdAt);
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
    action.innerHTML = '<div class="action-box-title">⚡ Proposition d\'Action</div>';
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
    notes.innerHTML = '<span class="notes-label">📝 Notes de suivi & actions menées :</span>';
    const noteContent = document.createElement('div');
    noteContent.className = 'notes-content markdown-body';
    noteContent.innerHTML = mdHtml(topic.notes);
    noteContent.contentEditable = state.editMode;
    noteContent.onblur = () => update(topic, { notes: htmlMd(noteContent) });
    notes.appendChild(noteContent);

    container.append(body, action, notes);
    if (state.editMode || topic.documents.length) container.appendChild(attachments(topic));
    return container;
  }

  function actionRow(topic, action, index) {
    const row = document.createElement('div');
    row.className = 'action-point-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'action-point-checkbox';
    checkbox.checked = !!action.done;
    checkbox.onchange = () => {
      topic.actions[index].done = checkbox.checked;
      saveTopic(topic).then(renderAll);
    };
    const span = document.createElement('span');
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

  function attachments(topic) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-attachments';
    const panel = document.createElement('div');
    panel.className = 'uploaded-documents-panel';
    const header = document.createElement('div');
    header.className = 'uploaded-documents-header';
    const title = document.createElement('span');
    title.className = 'uploaded-documents-title';
    title.textContent = '📎 Documents associés';
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
    link.href = documentData.href || '#';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `${documentData.type === 'image' ? '🖼️' : /\.(eml|msg)$/i.test(documentData.href || '') ? '✉️' : '📄'} ${documentData.label || documentData.href}`;
    if (documentData.type === 'image') {
      link.onclick = (event) => {
        event.preventDefault();
        els['lightbox-img'].src = documentData.href;
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
    const docs = state.topics.flatMap((topic) => topic.documents.map((documentData) => ({ topic, documentData })));
    if (!docs.length) {
      els['document-explorer-tree'].textContent = 'Aucun document associé.';
      return;
    }
    filters().forEach((filter) => {
      const related = docs.filter((item) => item.topic.filter === filter);
      if (!related.length) return;
      const box = document.createElement('div');
      box.className = 'tree-folder';
      box.innerHTML = `<div class="tree-folder-header"><span class="folder-arrow">▼</span> 📁 ${esc(label(filter))}</div><div class="tree-folder-content"></div>`;
      const content = box.querySelector('.tree-folder-content');
      related.forEach(({ documentData }) => content.appendChild(docLink(documentData)));
      box.querySelector('.tree-folder-header').onclick = () => {
        const hide = content.style.display !== 'none';
        content.style.display = hide ? 'none' : 'flex';
        box.querySelector('.folder-arrow').textContent = hide ? '▶' : '▼';
      };
      els['document-explorer-tree'].appendChild(box);
    });
  }

  function stats() {
    const counts = { active: 0, urgent: 0, todo: 0, partial: 0, resolved: 0 };
    state.topics.forEach((topic) => {
      const currentStatus = status(topic);
      if (currentStatus === 'resolved') counts.resolved += 1;
      else {
        counts.active += 1;
        if (topic.severity === 'urgent') counts.urgent += 1;
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
      card.classList.toggle('stat-filter-active', card.dataset.statFilter === state.statFilter);
    });
  }

  function status(topic) {
    const done = topic.actions.filter((action) => action.done).length;
    return done && done === topic.actions.length ? 'resolved' : done ? 'partial' : 'todo';
  }

  function badgeClass(currentStatus, severity) {
    return currentStatus === 'resolved' ? 'success' : currentStatus === 'partial' ? 'info' : severity === 'urgent' ? 'urgent' : 'warning';
  }

  function badgeText(currentStatus, severity) {
    return currentStatus === 'resolved' ? 'Traité' : currentStatus === 'partial' ? 'Partiellement traité' : severity === 'urgent' ? 'Urgent / Critique' : 'À Traiter';
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
    state.topics.sort((a, b) => a.title.localeCompare(b.title, 'fr', { numeric: true }));
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
    const filter = els['new-topic-filter'].value || DEFAULT_FILTER;
    try {
      const payload = await api('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter,
          title: text(els['new-topic-title']) || 'Nouveau sujet',
          severity: els['new-topic-severity'].value === 'urgent' ? 'urgent' : 'warning',
          body: text(els['new-topic-body']) || 'Contexte à compléter.',
          actions: getNewActions()
        })
      });
      replaceTopic(payload.topic);
      state.serverFilters = payload.filters || state.serverFilters;
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

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
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
