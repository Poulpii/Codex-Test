const http = require('node:http');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist');
const CONTENTS_DIR = path.join(ROOT, 'Contents');
const DOCUMENTS_DIR = path.join(ROOT, 'Documents');
const INCIDENTS_CONTENT_DIR = path.join(CONTENTS_DIR, 'Incidents');
const INCIDENTS_DOCUMENTS_DIR = path.join(DOCUMENTS_DIR, 'Incidents');
const DIRECTORY_CONTENT_DIR = path.join(CONTENTS_DIR, 'Annuaire');
const DIRECTORY_FILE = path.join(DIRECTORY_CONTENT_DIR, 'annuaireCopropriétaires.md');
const LEGACY_DIRECTORY_FILE = path.join(DIRECTORY_CONTENT_DIR, 'annuaire.md');
const ASSETS_DIR = path.join(ROOT, 'assets');
const CONFIG_FILE = path.join(ASSETS_DIR, 'config.md');
const FALLBACK_FILTER = 'Filtre';
const DEFAULT_DIRECTORY_OPTIONS = {
  building: ['A', 'B', 'C', 'Général', 'Autre'],
  floor: ['RDC', '1', '2', '3', '4', '5', '6', '7', '8', 'Autre'],
  occupancy: ['Occupant', 'Bailleur', 'Locataire', 'Vacant'],
  council: ['Non', 'Oui', 'Président', 'Membre', 'Suppléant']
};
const DIRECTORY_OPTION_LABELS = {
  building: 'Bâtiment',
  floor: 'Étage',
  occupancy: 'Occupant/Bailleur',
  council: 'Conseil syndical'
};
const DIRECTORY_OPTION_KEYS_BY_LABEL = Object.fromEntries(Object.entries(DIRECTORY_OPTION_LABELS).map(([key, label]) => [label.toLowerCase(), key]));
const TOPIC_STATUSES = new Set(['urgent', 'todo', 'partial', 'resolved']);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const ACCESS_TOKEN = process.env.COPROPRO_ACCESS_TOKEN || '';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const INLINE_DOCUMENT_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, '.pdf']);
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  '.pdf',
  '.eml',
  '.msg',
  '.txt',
  '.md',
  '.csv',
  '.rtf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx'
]);
const BLOCKED_DOCUMENT_EXTENSIONS = new Set(['.html', '.htm', '.xhtml', '.svg', '.js', '.mjs', '.css', '.xml']);
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'"
};

async function main() {
  if (requiresAccessToken() && !ACCESS_TOKEN) {
    console.error('Partage reseau refuse sans protection. Definissez COPROPRO_ACCESS_TOKEN avant de lancer avec HOST non local.');
    process.exit(1);
  }

  await ensureStorage();
  await ensureConfig();
  await migrateIncidentStorage();

  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      console.error(error);
      sendJson(res, error.status || 500, { error: error.message || 'Erreur serveur.' });
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Le port ${PORT} est deja utilise. Fermez l'ancienne fenetre Terminal de la web app, puis relancez Demarrer web app.command.`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(PORT, HOST, () => {
    console.log(`Copropro local: http://${HOST}:${PORT}`);
    if (HOST === '127.0.0.1') console.log('Pour partager sur le reseau local: HOST=0.0.0.0 npm start');
    else if (ACCESS_TOKEN) console.log('Acces reseau protege par COPROPRO_ACCESS_TOKEN. Ouvrez la page avec ?token=VOTRE_TOKEN.');
  });
}

async function ensureStorage() {
  await fs.mkdir(CONTENTS_DIR, { recursive: true });
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
  await fs.mkdir(INCIDENTS_CONTENT_DIR, { recursive: true });
  await fs.mkdir(INCIDENTS_DOCUMENTS_DIR, { recursive: true });
  await fs.mkdir(DIRECTORY_CONTENT_DIR, { recursive: true });
  await fs.mkdir(ASSETS_DIR, { recursive: true });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (needsAccessToken(pathname) && !authorized(req, url)) {
    return sendJson(res, 401, { error: 'Acces non autorise.' });
  }

  if (pathname === '/api/topics' && req.method === 'GET') return listTopics(res);
  if (pathname === '/api/config' && req.method === 'GET') return getConfig(res);
  if (pathname === '/api/config' && req.method === 'PUT') return updateConfig(req, res);
  if (pathname === '/api/directory' && req.method === 'GET') return getDirectory(res);
  if (pathname === '/api/directory' && req.method === 'PUT') return updateDirectory(req, res);
  if (pathname === '/api/topics' && req.method === 'POST') return createTopic(req, res);
  if (pathname.startsWith('/api/topics/') && pathname.endsWith('/attachments') && req.method === 'POST') return addAttachments(req, res, pathname);
  if (pathname.startsWith('/api/topics/') && pathname.includes('/documents/') && req.method === 'DELETE') return removeDocument(req, res, pathname);
  if (pathname.startsWith('/api/topics/') && req.method === 'DELETE') return deleteTopic(req, res, pathname);
  if (pathname.startsWith('/api/topics/') && req.method === 'PUT') return updateTopic(req, res, pathname);
  if (pathname === '/api/filters' && req.method === 'POST') return createFilter(req, res);
  if (pathname.startsWith('/api/filters/') && req.method === 'PATCH') return renameFilter(req, res, pathname);
  if (pathname.startsWith('/api/filters/') && req.method === 'DELETE') return deleteFilter(res, pathname);

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  sendJson(res, 405, { error: 'Methode non autorisee.' });
}

async function listTopics(res) {
  sendJson(res, 200, await readAllTopics());
}

async function getConfig(res) {
  sendJson(res, 200, await readConfig());
}

async function updateConfig(req, res) {
  const current = await readConfig();
  const data = await readJson(req);
  const next = {
    propertyAddress: text(data.propertyAddress ?? data.address ?? current.propertyAddress),
    syndicName: text(data.syndicName ?? data.syndic ?? current.syndicName),
    filters: uniqueStrings(Array.isArray(data.filters) ? data.filters.map(safeFilterName) : current.filters)
  };
  if (!next.filters.length) next.filters = [FALLBACK_FILTER];
  await writeConfig(next);
  sendJson(res, 200, await readConfig());
}

async function getDirectory(res) {
  sendJson(res, 200, await readDirectory());
}

async function updateDirectory(req, res) {
  const data = await readJson(req);
  const payload = normalizeDirectoryPayload(data);
  await writeDirectory(payload);
  sendJson(res, 200, await readDirectory());
}

async function createTopic(req, res) {
  const data = await readJson(req);
  const filter = safeFilterName(data.filter || await defaultFilterName());
  const number = await nextTopicNumber();
  const fileId = String(number).padStart(4, '0');
  const title = numberedTitle(number, text(data.title) || 'Nouveau sujet');
  const createdAt = todayIso();
  const sourceFile = await uniqueMarkdownFile(yearFromDate(createdAt), `${fileId}-${topicMarkdownFileName(createdAt, stripTopicNumber(title))}`);
  const topic = normTopic({
    id: fileId,
    title,
    createdAt,
    filter,
    folder: filter,
    status: topicStatus(data),
    sourceFile,
    body: text(data.body) || 'Contexte a completer.',
    notes: '',
    documents: [],
    actions: normActions(data.actions)
  });
  await writeTopic(topic);
  sendJson(res, 201, { topic, filters: await listFilters() });
}

async function updateTopic(req, res, pathname) {
  const id = pathname.split('/')[3];
  const existing = await findTopic(id);
  if (!existing) return sendJson(res, 404, { error: 'Sujet introuvable.' });
  const data = await readJson(req);
  const next = normTopic({
    ...existing.topic,
    ...data,
    id: existing.topic.id,
    sourceFile: existing.topic.sourceFile,
    filter: safeFilterName(data.filter || existing.topic.filter),
    folder: safeFilterName(data.filter || existing.topic.filter)
  });
  await writeTopic(next);
  if (existing.filePath !== topicPath(next)) await removeIfExists(existing.filePath);
  sendJson(res, 200, { topic: next, filters: await listFilters() });
}

async function addAttachments(req, res, pathname) {
  const id = pathname.split('/')[3];
  const found = await findTopic(id);
  if (!found) return sendJson(res, 404, { error: 'Sujet introuvable.' });

  const files = await readMultipartFiles(req);
  if (!files.length) return sendJson(res, 400, { error: 'Aucun fichier recu.' });

  const topic = found.topic;
  const year = topicYear(topic);
  for (const file of files) {
    validateAttachment(file);
    const safeName = safeFileName(file.filename || 'piece-jointe');
    const finalName = await uniqueDocumentFile(year, safeName);
    await fs.mkdir(path.join(INCIDENTS_DOCUMENTS_DIR, year), { recursive: true });
    await fs.writeFile(path.join(INCIDENTS_DOCUMENTS_DIR, year, finalName), file.buffer);
    topic.documents.push({
      label: file.filename || finalName,
      href: documentHref(year, finalName),
      type: (file.contentType || '').startsWith('image/') ? 'image' : 'file',
      description: 'Piece jointe enregistree dans le dossier Documents/Incidents.'
    });
  }
  await writeTopic(topic);
  sendJson(res, 200, { topic, filters: await listFilters() });
}

async function removeDocument(req, res, pathname) {
  const parts = pathname.split('/');
  const id = parts[3];
  const index = Number(parts[5]);
  const found = await findTopic(id);
  if (!found) return sendJson(res, 404, { error: 'Sujet introuvable.' });
  if (!Number.isInteger(index) || index < 0 || index >= found.topic.documents.length) {
    return sendJson(res, 400, { error: 'Document introuvable dans ce sujet.' });
  }
  found.topic.documents.splice(index, 1);
  await writeTopic(found.topic);
  sendJson(res, 200, { topic: found.topic, filters: await listFilters() });
}

async function deleteTopic(req, res, pathname) {
  const id = pathname.split('/')[3];
  const found = await findTopic(id);
  if (!found) return sendJson(res, 404, { error: 'Sujet introuvable.' });
  await fs.rm(found.filePath, { force: true });
  sendJson(res, 200, { ok: true, filters: await listFilters() });
}

async function createFilter(req, res) {
  const data = await readJson(req);
  const name = safeFilterName(data.name || '');
  if (!name) return sendJson(res, 400, { error: 'Nom de filtre manquant.' });
  const config = await readConfig();
  if (!config.filters.includes(name)) {
    config.filters.push(name);
    await writeConfig(config);
  }
  sendJson(res, 201, { filters: await listFilters() });
}

async function renameFilter(req, res, pathname) {
  const oldName = safeFilterName(pathname.split('/').slice(3).join('/'));
  const data = await readJson(req);
  const nextName = safeFilterName(data.name || '');
  if (!oldName || !nextName) return sendJson(res, 400, { error: 'Nom de filtre invalide.' });
  if (oldName === nextName) return sendJson(res, 200, await readAllTopics());
  if ((await listFilters()).includes(nextName)) return sendJson(res, 409, { error: 'Un filtre porte deja ce nom.' });

  const payload = await readAllTopics();
  for (const topic of payload.topics.filter((topic) => topic.filter === oldName || topic.folder === oldName)) {
    topic.filter = nextName;
    topic.folder = nextName;
    await writeTopic(topic);
  }
  const config = await readConfig();
  config.filters = uniqueStrings(config.filters.map((filter) => (filter === oldName ? nextName : filter)));
  if (!config.filters.includes(nextName)) config.filters.push(nextName);
  await writeConfig(config);
  sendJson(res, 200, await readAllTopics());
}

async function deleteFilter(res, pathname) {
  const name = safeFilterName(pathname.split('/').slice(3).join('/'));
  if (!name) return sendJson(res, 400, { error: 'Nom de filtre manquant.' });
  const payload = await readAllTopics();
  if (payload.topics.some((topic) => topic.filter === name || topic.folder === name)) {
    return sendJson(res, 409, { error: 'Ce filtre contient des sujets.' });
  }
  const config = await readConfig();
  config.filters = config.filters.filter((filter) => filter !== name);
  if (!config.filters.length) config.filters = [FALLBACK_FILTER];
  await writeConfig(config);
  sendJson(res, 200, { filters: await listFilters() });
}

async function readAllTopics() {
  await ensureStorage();
  const topics = [];
  const files = await topicFiles();
  for (const file of files) {
    const markdown = await fs.readFile(file.filePath, 'utf8');
    const topic = parseMd(markdown, { folder: file.filter, fileName: file.fileName, year: file.year });
    Object.defineProperty(topic, '_filePath', { value: file.filePath, enumerable: false });
    topics.push(topic);
  }
  topics.sort(topicSort);
  return { topics, filters: await listFiltersFromTopics(topics) };
}

async function topicFiles() {
  const out = [];
  await collectIncidentTopicFiles(out);
  await collectLegacyTopicFiles(out);
  return out;
}

async function collectIncidentTopicFiles(out) {
  const yearEntries = await fs.readdir(INCIDENTS_CONTENT_DIR, { withFileTypes: true }).catch(() => []);
  for (const yearEntry of yearEntries) {
    if (!yearEntry.isDirectory() || !isYearName(yearEntry.name)) continue;
    await collectTopicFiles(out, path.join(INCIDENTS_CONTENT_DIR, yearEntry.name), '', yearEntry.name);
  }
}

async function collectLegacyTopicFiles(out) {
  const rootEntries = await fs.readdir(CONTENTS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of rootEntries) {
    if (!entry.isDirectory() || entry.name === 'Incidents' || entry.name === 'Annuaire') continue;
    const firstPath = path.join(CONTENTS_DIR, entry.name);
    if (isYearName(entry.name)) {
      const filterEntries = await fs.readdir(firstPath, { withFileTypes: true }).catch(() => []);
      for (const filterEntry of filterEntries) {
        if (filterEntry.isDirectory()) await collectTopicFiles(out, path.join(firstPath, filterEntry.name), filterEntry.name, entry.name);
      }
    } else {
      await collectTopicFiles(out, firstPath, entry.name, '');
    }
  }
}

async function collectTopicFiles(out, dir, filter, year) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  entries.forEach((entry) => {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) return;
    out.push({ filePath: path.join(dir, entry.name), fileName: entry.name, filter, year });
  });
}

async function listFilters() {
  return listFiltersFromTopics((await readTopicSummaries()).topics);
}

async function readTopicSummaries() {
  const topics = [];
  const files = await topicFiles();
  for (const file of files) {
    const markdown = await fs.readFile(file.filePath, 'utf8');
    topics.push(parseMd(markdown, { folder: file.filter, fileName: file.fileName, year: file.year }));
  }
  return { topics };
}

async function listFiltersFromTopics(topics) {
  const config = await readConfig();
  return uniqueStrings([...config.filters, ...topics.map((topic) => topic.filter)]).sort((a, b) => {
    const ai = config.filters.indexOf(a);
    const bi = config.filters.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'fr');
  });
}

async function ensureConfig() {
  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await writeConfig({ propertyAddress: '', syndicName: '', filters: [FALLBACK_FILTER] });
  }
}

async function readConfig() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  await ensureConfig();
  const md = await fs.readFile(CONFIG_FILE, 'utf8');
  const parsed = parseConfig(md);
  return {
    propertyAddress: parsed.propertyAddress,
    syndicName: parsed.syndicName,
    filters: parsed.filters.length ? parsed.filters : [FALLBACK_FILTER]
  };
}

async function writeConfig(config) {
  const filters = uniqueStrings((config.filters || []).map(safeFilterName));
  const lines = [
    '# Configuration',
    '',
    '## Copropriété',
    '',
    `Adresse: ${text(config.propertyAddress)}`,
    `Syndic: ${text(config.syndicName)}`,
    '',
    '## Filtres',
    ''
  ];
  (filters.length ? filters : [FALLBACK_FILTER]).forEach((filter) => lines.push(`- ${filter}`));
  lines.push('');
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, lines.join('\n'), 'utf8');
}

async function ensureDirectory() {
  try {
    await fs.access(DIRECTORY_FILE);
  } catch {
    if (fss.existsSync(LEGACY_DIRECTORY_FILE)) {
      await fs.rename(LEGACY_DIRECTORY_FILE, DIRECTORY_FILE);
      return;
    }
    await writeDirectory({
      entries: [createDirectoryEntry('CP-001')],
      options: await legacyDirectoryOptionsFromConfig()
    });
  }
}

async function readDirectory() {
  await fs.mkdir(DIRECTORY_CONTENT_DIR, { recursive: true });
  await ensureDirectory();
  const markdown = await fs.readFile(DIRECTORY_FILE, 'utf8');
  return parseDirectory(markdown);
}

async function writeDirectory(payload) {
  const directory = normalizeDirectoryPayload(payload);
  await fs.mkdir(DIRECTORY_CONTENT_DIR, { recursive: true });
  await fs.writeFile(DIRECTORY_FILE, serializeDirectory(directory), 'utf8');
}

async function legacyDirectoryOptionsFromConfig() {
  await ensureConfig();
  const markdown = await fs.readFile(CONFIG_FILE, 'utf8');
  return normalizeDirectoryOptions(parseConfig(markdown).directoryOptions);
}

function serializeDirectory(payload) {
  const directory = normalizeDirectoryPayload(payload);
  const lines = ['# Annuaire', '', '## Choix des champs', ''];
  Object.entries(DIRECTORY_OPTION_LABELS).forEach(([key, label]) => {
    lines.push(`### ${label}`);
    directory.options[key].forEach((option) => lines.push(`- ${option}`));
    lines.push('');
  });
  lines.push('## Données du tableau', '', '```json', JSON.stringify(directory.entries, null, 2), '```', '');
  return lines.join('\n');
}

function parseDirectory(markdown) {
  const options = {};
  let section = '';
  let optionKey = '';
  String(markdown || '').split(/\r?\n/).forEach((line) => {
    const sectionHeading = line.match(/^##\s+(.+)$/);
    if (sectionHeading) {
      section = sectionHeading[1].trim().toLowerCase();
      optionKey = '';
      return;
    }
    const optionHeading = line.match(/^###\s+(.+)$/);
    if (section === 'choix des champs' && optionHeading) {
      optionKey = DIRECTORY_OPTION_KEYS_BY_LABEL[optionHeading[1].trim().toLowerCase()] || '';
      if (optionKey) options[optionKey] = [];
      return;
    }
    const option = line.match(/^\s*-\s+(.+)$/);
    if (section === 'choix des champs' && optionKey && option) options[optionKey].push(text(option[1]));
  });
  const entries = parseDirectoryEntries(markdown);
  return normalizeDirectoryPayload({ entries, options });
}

function parseDirectoryEntries(markdown) {
  const match = String(markdown || '').match(/##\s+Données du tableau[\s\S]*?```json\s*([\s\S]*?)\s*```/i);
  if (!match) return [createDirectoryEntry('CP-001')];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed.map(normalizeDirectoryEntry) : [createDirectoryEntry('CP-001')];
  } catch {
    return [createDirectoryEntry('CP-001')];
  }
}

function normalizeDirectoryPayload(payload = {}) {
  const entries = Array.isArray(payload.entries) ? payload.entries.map(normalizeDirectoryEntry) : [createDirectoryEntry('CP-001')];
  return {
    entries: entries.length ? entries : [createDirectoryEntry('CP-001')],
    options: normalizeDirectoryOptions(payload.options)
  };
}

function createDirectoryEntry(id) {
  return {
    id: text(id) || 'CP-001',
    name: '',
    email: '',
    phone: '',
    address: '',
    lot: '',
    building: '',
    floor: '',
    occupancy: '',
    council: ''
  };
}

function normalizeDirectoryEntry(entry = {}) {
  return {
    id: directoryText(entry.id) || 'CP-001',
    name: directoryText(entry.name),
    email: directoryText(entry.email),
    phone: directoryText(entry.phone),
    address: directoryText(entry.address),
    lot: directoryText(entry.lot),
    building: text(entry.building),
    floor: text(entry.floor),
    occupancy: text(entry.occupancy),
    council: text(entry.council)
  };
}

function parseConfig(md) {
  const data = { propertyAddress: '', syndicName: '', filters: [], directoryOptions: {} };
  let section = '';
  let directoryOptionKey = '';
  String(md || '').split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      directoryOptionKey = '';
      return;
    }
    if (section === 'choix annuaire') {
      const optionHeading = line.match(/^([^:]+)\s*:\s*$/);
      if (optionHeading) {
        directoryOptionKey = DIRECTORY_OPTION_KEYS_BY_LABEL[optionHeading[1].trim().toLowerCase()] || '';
        if (directoryOptionKey && !Array.isArray(data.directoryOptions[directoryOptionKey])) data.directoryOptions[directoryOptionKey] = [];
        return;
      }
    }
    const address = line.match(/^Adresse\s*:\s*(.*)$/i);
    if (address) {
      data.propertyAddress = text(address[1]);
      return;
    }
    const syndic = line.match(/^Syndic\s*:\s*(.*)$/i);
    if (syndic) {
      data.syndicName = text(syndic[1]);
      return;
    }
    const filter = line.match(/^\s*-\s+(.+)$/);
    if (section === 'filtres' && filter) data.filters.push(safeFilterName(filter[1]));
    if (section === 'choix annuaire' && directoryOptionKey && filter) data.directoryOptions[directoryOptionKey].push(text(filter[1]));
  });
  data.filters = uniqueStrings(data.filters);
  data.directoryOptions = normalizeDirectoryOptions(data.directoryOptions);
  return data;
}

async function migrateIncidentStorage() {
  await migrateContentsToIncidents();
  await migrateDocumentsToIncidents();
}

async function migrateContentsToIncidents() {
  const legacyFiles = [];
  await collectLegacyTopicFiles(legacyFiles);
  for (const file of legacyFiles) {
    if (!fss.existsSync(file.filePath)) continue;
    const markdown = await fs.readFile(file.filePath, 'utf8');
    const topic = parseMd(markdown, { folder: file.filter, fileName: file.fileName, year: file.year });
    const year = topicYear(topic);
    const nextDir = path.join(INCIDENTS_CONTENT_DIR, year);
    await fs.mkdir(nextDir, { recursive: true });
    const nextName = await uniqueNameInDir(nextDir, file.fileName);
    topic.sourceFile = nextName;
    await writeTopic(topic);
    await fs.rm(file.filePath, { force: true });
  }
}

async function migrateDocumentsToIncidents() {
  const payload = await readAllTopics();
  const movedPaths = new Set();
  for (const topic of payload.topics) {
    let changed = false;
    const year = topicYear(topic);
    for (const document of topic.documents) {
      if (!isLegacyDocumentHref(document.href)) continue;
      const oldPath = safeJoin(ROOT, document.href);
      const fileName = path.basename(document.href);
      const nextDir = path.join(INCIDENTS_DOCUMENTS_DIR, year);
      await fs.mkdir(nextDir, { recursive: true });
      const nextName = oldPath && fss.existsSync(oldPath) ? await uniqueNameInDir(nextDir, fileName) : fileName;
      if (oldPath && fss.existsSync(oldPath)) {
        await fs.rename(oldPath, path.join(nextDir, nextName));
        movedPaths.add(oldPath);
      }
      document.href = documentHref(year, nextName);
      changed = true;
    }
    if (changed) await writeTopic(topic);
  }

  await moveLooseDocumentFiles(movedPaths);
}

async function moveLooseDocumentFiles(movedPaths) {
  const entries = await fs.readdir(DOCUMENTS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === 'Incidents' || entry.name === '.DS_Store') continue;
    const source = path.join(DOCUMENTS_DIR, entry.name);
    if (movedPaths.has(source)) continue;
    if (entry.isFile()) {
      await moveDocumentFile(source, currentYear(), entry.name);
      continue;
    }
    if (entry.isDirectory() && isYearName(entry.name)) {
      const files = await fs.readdir(source, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (file.isFile() && file.name !== '.DS_Store') await moveDocumentFile(path.join(source, file.name), entry.name, file.name);
      }
    }
  }
}

async function moveDocumentFile(source, year, fileName) {
  const nextDir = path.join(INCIDENTS_DOCUMENTS_DIR, year);
  await fs.mkdir(nextDir, { recursive: true });
  const nextName = await uniqueNameInDir(nextDir, fileName);
  await fs.rename(source, path.join(nextDir, nextName));
}

function isLegacyDocumentHref(href) {
  const value = String(href || '');
  return /^Documents\/[^/]+$/i.test(value) || /^Documents\/\d{4}\/[^/]+$/i.test(value);
}

async function defaultFilterName() {
  const config = await readConfig();
  return config.filters[0] || FALLBACK_FILTER;
}

async function nextTopicNumber() {
  const payload = await readAllTopics();
  const maxNumber = payload.topics.reduce((max, topic) => Math.max(max, topicNumber(topic)), 0);
  return Math.max(maxNumber, payload.topics.length) + 1;
}

async function findTopic(id) {
  const payload = await readAllTopics();
  const topic = payload.topics.find((item) => item.id === id);
  if (!topic) return null;
  return { topic, filePath: topic._filePath || topicPath(topic) };
}

function topicPath(topic) {
  const file = safeMarkdownFileName(topic.sourceFile || `${safeFileName(topic.id || Date.now())}.md`);
  const filePath = path.join(INCIDENTS_CONTENT_DIR, topicYear(topic), file);
  if (!isInside(INCIDENTS_CONTENT_DIR, filePath)) throw Object.assign(new Error('Chemin de sujet invalide.'), { status: 400 });
  return filePath;
}

async function writeTopic(topic) {
  const next = normTopic(topic);
  const filePath = topicPath(next);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serialize(next), 'utf8');
}

async function uniqueMarkdownFile(year, fileName) {
  const dir = path.join(INCIDENTS_CONTENT_DIR, year);
  await fs.mkdir(dir, { recursive: true });
  return uniqueNameInDir(dir, safeMarkdownFileName(fileName));
}

async function uniqueDocumentFile(year, fileName) {
  const dir = path.join(INCIDENTS_DOCUMENTS_DIR, year);
  await fs.mkdir(dir, { recursive: true });
  return uniqueNameInDir(dir, safeFileName(fileName));
}

async function uniqueNameInDir(dir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = fileName;
  let i = 2;
  while (fss.existsSync(path.join(dir, candidate))) {
    candidate = `${parsed.name}-${i}${parsed.ext}`;
    i += 1;
  }
  return candidate;
}

function parseMd(md, meta = {}) {
  const match = String(md).match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = match ? parseFm(match[1]) : {};
  const body = match ? md.slice(match[0].length) : md;
  const sections = parseSections(body);
  return normTopic({
    ...fm,
    body: sections['Contexte'] || body.trim(),
    notes: sections['Notes de suivi'] || '',
    folder: meta.folder || fm.filter,
    filter: fm.filter || meta.folder || FALLBACK_FILTER,
    createdAt: fm.createdAt || (meta.year ? `${meta.year}-01-01` : ''),
    sourceFile: meta.fileName || fm.sourceFile
  });
}

function parseFm(source) {
  const data = {};
  const lines = String(source || '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (key === 'documents' || key === 'actions') {
      const items = [];
      for (i += 1; i < lines.length && /^\s/.test(lines[i]);) {
        if (/^\s*\[\]/.test(lines[i])) {
          i += 1;
          continue;
        }
        const first = lines[i].match(/^\s*-\s*([A-Za-z0-9_-]+):\s*(.*)$/);
        if (first) {
          const item = { [first[1]]: scalar(first[2]) };
          for (i += 1; i < lines.length;) {
            const child = lines[i].match(/^\s{4}([A-Za-z0-9_-]+):\s*(.*)$/);
            if (!child) break;
            item[child[1]] = scalar(child[2]);
            i += 1;
          }
          items.push(item);
          continue;
        }
        const simple = lines[i].match(/^\s*-\s*(.*)$/);
        if (simple) items.push(scalar(simple[1]));
        i += 1;
      }
      i -= 1;
      data[key] = items;
    } else {
      data[key] = scalar(match[2]);
    }
  }
  return data;
}

function scalar(value) {
  const raw = String(value || '').trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if ((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'")) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return raw;
}

function parseSections(md) {
  const out = {};
  let current = 'Contexte';
  let buffer = [];
  String(md || '').split('\n').forEach((line) => {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      out[current] = buffer.join('\n').trim();
      current = heading[1].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  });
  out[current] = buffer.join('\n').trim();
  return out;
}

function normTopic(topic) {
  const filter = safeFilterName(topic.filter || topic.folder || FALLBACK_FILTER);
  const priority = topic.priority === 'urgent' || topic.status === 'urgent' ? 'urgent' : '';
  const next = {
    id: topic.id || `topic-${Date.now()}`,
    title: text(topic.title) || 'Nouveau sujet',
    createdAt: topic.createdAt || '',
    filter,
    folder: filter,
    priority,
    status: topicStatus(topic),
    sourceFile: safeMarkdownFileName(topic.sourceFile || `${topic.id || Date.now()}.md`),
    body: topic.body || 'Contexte à compléter.',
    notes: topic.notes || '',
    documents: Array.isArray(topic.documents) ? topic.documents.map(normDocument) : [],
    actions: normActions(topic.actions)
  };
  next.status = topicStatus(next);
  return next;
}

function normDocument(document) {
  return {
    label: text(document.label || document.href || 'Document'),
    href: text(document.href || ''),
    type: document.type === 'image' ? 'image' : 'file',
    description: text(document.description || '')
  };
}

function normActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return [{ text: 'Nouvelle action à préciser', done: false }];
  return actions.map((action) => {
    if (typeof action === 'string') return { text: text(action) || 'Nouvelle action à préciser', done: false };
    return { text: text(action.text) || 'Nouvelle action à préciser', done: Boolean(action.done) };
  });
}

function serialize(topic) {
  const lines = ['---', `id: ${yq(topic.id)}`, `title: ${yq(topic.title)}`];
  if (topic.createdAt) lines.push(`createdAt: ${yq(topic.createdAt)}`);
  lines.push(`filter: ${yq(topic.filter)}`, `status: ${yq(topicStatus(topic))}`);
  if (topic.priority === 'urgent' || topic.status === 'urgent') lines.push('priority: "urgent"');
  lines.push(`sourceFile: ${yq(topic.sourceFile)}`, 'documents:');
  if (topic.documents.length) {
    topic.documents.forEach((document) => {
      lines.push(`  - label: ${yq(document.label || '')}`, `    href: ${yq(document.href || '')}`, `    type: ${yq(document.type || 'file')}`);
      if (document.description) lines.push(`    description: ${yq(document.description)}`);
    });
  } else {
    lines.push('  []');
  }
  lines.push('actions:');
  topic.actions.forEach((action) => {
    lines.push(`  - text: ${yq(action.text || '')}`, `    done: ${action.done ? 'true' : 'false'}`);
  });
  lines.push('---', '', '## Contexte', '', topic.body || '', '', '## Notes de suivi', '', topic.notes || '', '');
  return lines.join('\n');
}

function topicStatus(topic) {
  const actions = Array.isArray(topic.actions) ? topic.actions : [];
  const done = actions.filter((action) => action.done).length;
  if (done && done === actions.length) return 'resolved';
  if (topic.priority === 'urgent' || topic.status === 'urgent') return 'urgent';
  if (done) return 'partial';
  if (topic.status === 'resolved' || topic.status === 'partial') return 'todo';
  if (TOPIC_STATUSES.has(topic.status)) return topic.status;
  return 'todo';
}

function topicNumber(topic) {
  const id = String(topic.id || '');
  if (/^\d{4}$/.test(id)) return Number(id);
  const sourceMatch = String(topic.sourceFile || '').match(/^(\d{4})[-_]/);
  if (sourceMatch) return Number(sourceMatch[1]);
  const titleMatch = String(topic.title || '').match(/^(\d{2,})\s*-\s+/);
  return titleMatch ? Number(titleMatch[1]) : 0;
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

function numberedTitle(number, title) {
  return `${String(number).padStart(2, '0')} - ${stripTopicNumber(title)}`;
}

function stripTopicNumber(title) {
  return text(title).replace(/^\d{2,}\s*-\s+/, '') || 'Nouveau sujet';
}

function topicMarkdownFileName(dateIso, title) {
  const date = new Date(`${dateIso}T00:00:00`);
  const months = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  return `${String(date.getDate()).padStart(2, '0')}-${months[date.getMonth()]}-${date.getFullYear()}-${fileTitle(title)}.md`;
}

function topicYear(topic) {
  return yearFromDate(topic.createdAt) || currentYear();
}

function yearFromDate(value) {
  const match = String(value || '').match(/^(\d{4})-/);
  return match ? match[1] : '';
}

function currentYear() {
  return String(new Date().getFullYear());
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isYearName(name) {
  return /^\d{4}$/.test(String(name || ''));
}

function documentHref(year, fileName) {
  return `Documents/Incidents/${year}/${fileName}`;
}

async function serveStatic(req, res, pathname) {
  let filePath;
  if (pathname === '/') filePath = path.join(DIST_DIR, 'index.html');
  else if (pathname === '/index.html') filePath = path.join(DIST_DIR, 'index.html');
  else if (pathname.startsWith('/assets/')) filePath = safeJoin(ROOT, pathname.slice(1));
  else if (pathname.startsWith('/Documents/')) filePath = safeJoin(ROOT, pathname.slice(1));
  else filePath = safeJoin(DIST_DIR, pathname.slice(1));

  if (!filePath || !isInside(ROOT, filePath)) return sendText(res, 400, 'Chemin invalide.');
  if (pathname.startsWith('/Documents/') && blockedDocument(filePath)) return sendText(res, 403, 'Type de document non autorise.');
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, responseHeaders({
      'Content-Type': servedContentType(pathname, filePath),
      'Cache-Control': 'no-store',
      ...documentHeaders(pathname, filePath)
    }));
    if (req.method !== 'HEAD') res.end(data);
    else res.end();
  } catch {
    if (pathname !== '/' && pathname !== '/index.html' && !pathname.includes('.')) {
      return serveStatic(req, res, '/');
    }
    sendText(res, 404, 'Fichier introuvable.');
  }
}

function safeJoin(base, relativePath) {
  const resolved = path.resolve(base, relativePath);
  return isInside(base, resolved) ? resolved : null;
}

function requiresAccessToken(host = HOST) {
  return !LOCAL_HOSTS.has(host);
}

function needsAccessToken(pathname) {
  if (!ACCESS_TOKEN) return false;
  return pathname.startsWith('/api/') || pathname.startsWith('/Documents/');
}

function authorized(req, url) {
  const provided = req.headers['x-copropro-token'] || url.searchParams.get('token') || url.searchParams.get('access_token') || '';
  return constantTimeEqual(String(provided), ACCESS_TOKEN);
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON invalide.'), { status: 400 });
  }
}

function readBody(req, maxBytes = MAX_UPLOAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Requete trop volumineuse.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validateAttachment(file) {
  const ext = path.extname(file.filename || '').toLowerCase();
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error(`Type de fichier non autorise : ${ext || 'sans extension'}.`), { status: 415 });
  }
}

async function readMultipartFiles(req) {
  const contentTypeHeader = req.headers['content-type'] || '';
  const boundaryMatch = contentTypeHeader.match(/boundary=([^;]+)/);
  if (!boundaryMatch) throw Object.assign(new Error('Formulaire multipart invalide.'), { status: 400 });
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const buffer = await readBody(req);
  const parts = splitBuffer(buffer, boundary).slice(1, -1);
  const files = [];
  for (let part of parts) {
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd).toString('utf8');
    let body = part.slice(headerEnd + 4);
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);
    const disposition = headers.match(/content-disposition:[^\n]+/i)?.[0] || '';
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (!filename) continue;
    const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] || '';
    files.push({ filename, contentType, buffer: body });
  }
  return files;
}

function splitBuffer(buffer, separator) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function safeFilterName(name) {
  return text(name).replace(/[\\/:*?"<>|\x00-\x1F]/g, '-').replace(/^\.+$/g, '').slice(0, 100) || FALLBACK_FILTER;
}

function normalizeDirectoryOptions(options = {}) {
  return Object.fromEntries(
    Object.keys(DEFAULT_DIRECTORY_OPTIONS).map((key) => {
      const values = Array.isArray(options[key]) ? options[key] : DEFAULT_DIRECTORY_OPTIONS[key];
      const normalized = uniqueStrings(values.map(text).filter(Boolean));
      return [key, normalized.length ? normalized : DEFAULT_DIRECTORY_OPTIONS[key]];
    })
  );
}

function safeFileName(name) {
  const parsed = path.parse(String(name || 'piece-jointe'));
  const base = fileTitle(parsed.name).slice(0, 90) || 'piece-jointe';
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  return `${base}${ext}`;
}

function safeMarkdownFileName(name) {
  const safe = safeFileName(name);
  return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`;
}

function fileTitle(value) {
  return String(value || 'Sujet')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'Sujet';
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function directoryText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map(text).filter(Boolean)));
}

function yq(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.md': 'text/markdown; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function servedContentType(pathname, filePath) {
  if (!pathname.startsWith('/Documents/')) return contentType(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return INLINE_DOCUMENT_EXTENSIONS.has(ext) ? contentType(filePath) : 'application/octet-stream';
}

function blockedDocument(filePath) {
  return BLOCKED_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function documentHeaders(pathname, filePath) {
  if (!pathname.startsWith('/Documents/')) return {};
  const ext = path.extname(filePath).toLowerCase();
  if (INLINE_DOCUMENT_EXTENSIONS.has(ext)) return {};
  return { 'Content-Disposition': `attachment; filename="${downloadFileName(filePath)}"` };
}

function downloadFileName(filePath) {
  return path.basename(filePath).replace(/["\r\n]/g, '_');
}

async function removeIfExists(filePath) {
  await fs.rm(filePath, { force: true }).catch(() => {});
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, responseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, value) {
  res.writeHead(statusCode, responseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
  res.end(value);
}

function responseHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  blockedDocument,
  contentType,
  documentHeaders,
  documentHref,
  needsAccessToken,
  normalizeDirectoryOptions,
  parseDirectory,
  parseConfig,
  requiresAccessToken,
  responseHeaders,
  safeFileName,
  serializeDirectory,
  servedContentType,
  topicPath,
  validateAttachment
};
