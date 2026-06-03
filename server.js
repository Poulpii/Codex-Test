const http = require('node:http');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const CONTENTS_DIR = path.join(ROOT, 'Contents');
const DOCUMENTS_DIR = path.join(ROOT, 'Documents');
const ASSETS_DIR = path.join(ROOT, 'assets');
const CONFIG_FILE = path.join(ASSETS_DIR, 'config.md');
const FALLBACK_FILTER = 'Filtre';
const DEFAULT_PROPERTY_ADDRESS = '';
const DEFAULT_SYNDIC_NAME = '';
const TOPIC_STATUSES = new Set(['urgent', 'todo', 'partial', 'resolved']);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await fs.mkdir(CONTENTS_DIR, { recursive: true });
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  await ensureConfig();
  for (const filter of (await readConfig()).filters) {
    await fs.mkdir(path.join(CONTENTS_DIR, filter), { recursive: true });
  }

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
    console.log(`Suivi Copro local: http://${HOST}:${PORT}`);
    if (HOST === '127.0.0.1') {
      console.log('Pour partager sur le reseau local: HOST=0.0.0.0 npm start');
    }
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/topics' && req.method === 'GET') return listTopics(res);
  if (pathname === '/api/config' && req.method === 'GET') return getConfig(res);
  if (pathname === '/api/config' && req.method === 'PUT') return updateConfig(req, res);
  if (pathname === '/api/topics' && req.method === 'POST') return createTopic(req, res);
  if (pathname.startsWith('/api/topics/') && pathname.endsWith('/attachments') && req.method === 'POST') {
    return addAttachments(req, res, pathname);
  }
  if (pathname.startsWith('/api/topics/') && pathname.includes('/documents/') && req.method === 'DELETE') {
    return removeDocument(req, res, pathname);
  }
  if (pathname.startsWith('/api/topics/') && req.method === 'DELETE') return deleteTopic(req, res, pathname);
  if (pathname.startsWith('/api/topics/') && req.method === 'PUT') return updateTopic(req, res, pathname);
  if (pathname === '/api/filters' && req.method === 'POST') return createFilter(req, res);
  if (pathname.startsWith('/api/filters/') && req.method === 'PATCH') return renameFilter(req, res, pathname);
  if (pathname.startsWith('/api/filters/') && req.method === 'DELETE') return deleteFilter(res, pathname);

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  sendJson(res, 405, { error: 'Methode non autorisee.' });
}

async function listTopics(res) {
  const payload = await readAllTopics();
  sendJson(res, 200, payload);
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
  for (const filter of next.filters) {
    await fs.mkdir(path.join(CONTENTS_DIR, filter), { recursive: true });
  }
  await writeConfig(next);
  sendJson(res, 200, await readConfig());
}

async function createTopic(req, res) {
  const data = await readJson(req);
  const filter = safeFilterName(data.filter || await defaultFilterName());
  const title = text(data.title) || 'Nouveau sujet';
  const createdAt = todayIso();
  const sourceFile = await uniqueMarkdownFile(filter, topicMarkdownFileName(createdAt, title));
  const topic = normTopic({
    id: `topic-${Date.now()}`,
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
  sendJson(res, 201, { topic, filters: await listFilterFolders() });
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
  sendJson(res, 200, { topic: next, filters: await listFilterFolders() });
}

async function addAttachments(req, res, pathname) {
  const id = pathname.split('/')[3];
  const found = await findTopic(id);
  if (!found) return sendJson(res, 404, { error: 'Sujet introuvable.' });

  const files = await readMultipartFiles(req);
  if (!files.length) return sendJson(res, 400, { error: 'Aucun fichier recu.' });

  const topic = found.topic;
  for (const file of files) {
    const safeName = safeFileName(file.filename || 'piece-jointe');
    const finalName = await uniqueDocumentFile(safeName);
    await fs.writeFile(path.join(DOCUMENTS_DIR, finalName), file.buffer);
    topic.documents.push({
      label: file.filename || finalName,
      href: `Documents/${finalName}`,
      type: (file.contentType || '').startsWith('image/') ? 'image' : 'file',
      description: 'Piece jointe enregistree dans le dossier Documents.'
    });
  }
  await writeTopic(topic);
  sendJson(res, 200, { topic, filters: await listFilterFolders() });
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
  sendJson(res, 200, { topic: found.topic, filters: await listFilterFolders() });
}

async function deleteTopic(req, res, pathname) {
  const id = pathname.split('/')[3];
  const found = await findTopic(id);
  if (!found) return sendJson(res, 404, { error: 'Sujet introuvable.' });
  await fs.rm(found.filePath, { force: true });
  sendJson(res, 200, { ok: true, filters: await listFilterFolders() });
}

async function createFilter(req, res) {
  const data = await readJson(req);
  const name = safeFilterName(data.name || '');
  if (!name) return sendJson(res, 400, { error: 'Nom de filtre manquant.' });
  await fs.mkdir(path.join(CONTENTS_DIR, name), { recursive: true });
  const config = await readConfig();
  if (!config.filters.includes(name)) {
    config.filters.push(name);
    await writeConfig(config);
  }
  sendJson(res, 201, { filters: await listFilterFolders() });
}

async function renameFilter(req, res, pathname) {
  const oldName = safeFilterName(pathname.split('/').slice(3).join('/'));
  const data = await readJson(req);
  const nextName = safeFilterName(data.name || '');
  if (!oldName || !nextName) return sendJson(res, 400, { error: 'Nom de filtre invalide.' });
  if (oldName === nextName) return sendJson(res, 200, await readAllTopics());

  const oldDir = path.join(CONTENTS_DIR, oldName);
  const nextDir = path.join(CONTENTS_DIR, nextName);
  if (!isInside(CONTENTS_DIR, oldDir) || !isInside(CONTENTS_DIR, nextDir)) {
    return sendJson(res, 400, { error: 'Chemin de filtre invalide.' });
  }
  if (fss.existsSync(nextDir)) return sendJson(res, 409, { error: 'Un filtre porte deja ce nom.' });
  await fs.rename(oldDir, nextDir);

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
  const dir = path.join(CONTENTS_DIR, name);
  if (!isInside(CONTENTS_DIR, dir)) return sendJson(res, 400, { error: 'Chemin de filtre invalide.' });
  const entries = await fs.readdir(dir).catch(() => []);
  if (entries.some((entry) => entry.toLowerCase().endsWith('.md'))) {
    return sendJson(res, 409, { error: 'Ce filtre contient des sujets.' });
  }
  await fs.rm(dir, { recursive: true, force: true });
  const config = await readConfig();
  config.filters = config.filters.filter((filter) => filter !== name);
  if (!config.filters.length) config.filters = [FALLBACK_FILTER];
  await writeConfig(config);
  sendJson(res, 200, { filters: await listFilterFolders() });
}

async function readAllTopics() {
  await fs.mkdir(CONTENTS_DIR, { recursive: true });
  const filters = await listFilterFolders();
  const topics = [];
  for (const filter of filters) {
    const dir = path.join(CONTENTS_DIR, filter);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const filePath = path.join(dir, entry.name);
      const markdown = await fs.readFile(filePath, 'utf8');
      topics.push(parseMd(markdown, { folder: filter, fileName: entry.name }));
    }
  }
  topics.sort((a, b) => a.title.localeCompare(b.title, 'fr', { numeric: true }));
  return { topics, filters };
}

async function listFilterFolders() {
  const config = await readConfig();
  const folders = await listFilterDirs();
  return uniqueStrings([...config.filters, ...folders]);
}

async function listFilterDirs() {
  const entries = await fs.readdir(CONTENTS_DIR, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b, 'fr'));
}

async function ensureConfig() {
  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await writeConfig({
      propertyAddress: DEFAULT_PROPERTY_ADDRESS,
      syndicName: DEFAULT_SYNDIC_NAME,
      filters: await listFilterDirs()
    });
  }
}

async function readConfig() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  await ensureConfig();
  const md = await fs.readFile(CONFIG_FILE, 'utf8');
  const parsed = parseConfig(md);
  const folders = await listFilterDirs();
  const filters = uniqueStrings([...(parsed.filters.length ? parsed.filters : []), ...folders]);
  return {
    propertyAddress: parsed.propertyAddress || DEFAULT_PROPERTY_ADDRESS,
    syndicName: parsed.syndicName || DEFAULT_SYNDIC_NAME,
    filters: filters.length ? filters : [FALLBACK_FILTER]
  };
}

async function defaultFilterName() {
  const config = await readConfig();
  return config.filters[0] || FALLBACK_FILTER;
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

function parseConfig(md) {
  const data = { propertyAddress: '', syndicName: '', filters: [] };
  let section = '';
  String(md || '').split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      return;
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
  });
  data.filters = uniqueStrings(data.filters);
  return data;
}

async function findTopic(id) {
  const payload = await readAllTopics();
  const topic = payload.topics.find((item) => item.id === id);
  if (!topic) return null;
  return { topic, filePath: topicPath(topic) };
}

function topicPath(topic) {
  const filter = safeFilterName(topic.filter || topic.folder || FALLBACK_FILTER);
  const file = safeMarkdownFileName(topic.sourceFile || `${safeFileName(topic.id || Date.now())}.md`);
  const filePath = path.join(CONTENTS_DIR, filter, file);
  if (!isInside(CONTENTS_DIR, filePath)) throw Object.assign(new Error('Chemin de sujet invalide.'), { status: 400 });
  return filePath;
}

async function writeTopic(topic) {
  const next = normTopic(topic);
  const filePath = topicPath(next);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serialize(next), 'utf8');
}

async function uniqueMarkdownFile(filter, fileName) {
  const safe = safeMarkdownFileName(fileName);
  const parsed = path.parse(safe);
  let candidate = safe;
  let i = 2;
  while (fss.existsSync(path.join(CONTENTS_DIR, filter, candidate))) {
    candidate = `${parsed.name}-${i}${parsed.ext || '.md'}`;
    i += 1;
  }
  return candidate;
}

async function uniqueDocumentFile(fileName) {
  const parsed = path.parse(fileName);
  let candidate = fileName;
  let i = 2;
  while (fss.existsSync(path.join(DOCUMENTS_DIR, candidate))) {
    candidate = `${parsed.name}-${i}${parsed.ext}`;
    i += 1;
  }
  return candidate;
}

function imageExtension(fileName, contentType) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext)) return ext;
  return {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif'
  }[String(contentType || '').toLowerCase()] || '.jpg';
}

async function serveStatic(req, res, pathname) {
  let filePath;
  if (pathname === '/') filePath = path.join(ROOT, 'index.html');
  else if (pathname.startsWith('/assets/')) filePath = safeJoin(ROOT, pathname.slice(1));
  else if (pathname.startsWith('/Documents/')) filePath = safeJoin(ROOT, pathname.slice(1));
  else if (pathname === '/index.html') filePath = path.join(ROOT, 'index.html');
  else return sendText(res, 404, 'Fichier introuvable.');

  if (!filePath || !isInside(ROOT, filePath)) return sendText(res, 400, 'Chemin invalide.');
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': 'no-store' });
    if (req.method !== 'HEAD') res.end(data);
    else res.end();
  } catch {
    sendText(res, 404, 'Fichier introuvable.');
  }
}

function safeJoin(base, relativePath) {
  const resolved = path.resolve(base, relativePath);
  return isInside(base, resolved) ? resolved : null;
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
    filter: fm.filter || meta.folder,
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
  const next = {
    id: topic.id || `topic-${Date.now()}`,
    title: text(topic.title) || 'Nouveau sujet',
    createdAt: topic.createdAt || '',
    filter,
    folder: filter,
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
  lines.push(
    `filter: ${yq(topic.filter)}`,
    `status: ${yq(topicStatus(topic))}`,
    `sourceFile: ${yq(topic.sourceFile)}`,
    'documents:'
  );
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
  if (done) return 'partial';
  if (TOPIC_STATUSES.has(topic.status)) return topic.status;
  return 'todo';
}

function topicMarkdownFileName(dateIso, title) {
  const date = new Date(`${dateIso}T00:00:00`);
  const months = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  return `${String(date.getDate()).padStart(2, '0')}-${months[date.getMonth()]}-${date.getFullYear()}-${fileTitle(title)}.md`;
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function safeFilterName(name) {
  return text(name).replace(/[\\/:*?"<>|\x00-\x1F]/g, '-').replace(/^\.+$/g, '').slice(0, 100) || FALLBACK_FILTER;
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

async function removeIfExists(filePath) {
  await fs.rm(filePath, { force: true }).catch(() => {});
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
