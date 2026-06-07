import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { AppIcon } from "./components/AppIcon";
import { Sidebar } from "./components/Sidebar";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Empty, Input, Label, Textarea } from "./components/ui";
import { api } from "./lib/api";
import { documentHref, initAccessToken } from "./lib/accessToken";
import {
  badgeText,
  documentYear,
  markdownToHtml,
  normalizeActions,
  normalizeTopic,
  parseNoteEntries,
  serializeNoteEntries,
  topicSort,
  topicStatus
} from "./lib/topics";
import { formatBytes, formatDate, text, todayIso, unique } from "./lib/utils";
import type { AppConfig, DirectoryEntry, DirectoryOptions, StatFilter, Topic, TopicAction, TopicDocument, TopicStatus, ViewName } from "./types";

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const FALLBACK_FILTER = "Filtre";
const DIRECTORY_STORAGE_KEY = "copropro_directory_entries";
const PAGE_TITLES: Record<ViewName, string> = {
  incidents: "Gestion d'Incidents",
  directory: "Annuaire",
  contract: "Contrats"
};

const STATUS_CARDS: Array<{ id: StatFilter; label: string; icon: string; countKey: StatFilter }> = [
  { id: "active", label: "Tous les Incidents", icon: "status-active", countKey: "active" },
  { id: "urgent", label: "Urgents", icon: "status-urgent", countKey: "urgent" },
  { id: "todo", label: "À Traiter", icon: "status-todo", countKey: "todo" },
  { id: "partial", label: "Partiellement Traité", icon: "status-partial", countKey: "partial" },
  { id: "resolved", label: "Traités", icon: "status-resolved", countKey: "resolved" }
];

const DEFAULT_DIRECTORY_OPTIONS: DirectoryOptions = {
  building: ["A", "B", "C", "Général", "Autre"],
  floor: ["RDC", "1", "2", "3", "4", "5", "6", "7", "8", "Autre"],
  occupancy: ["Occupant", "Bailleur", "Locataire", "Vacant"],
  council: ["Non", "Oui", "Président", "Membre", "Suppléant"]
};

const DIRECTORY_OPTION_LABELS: Record<keyof DirectoryOptions, string> = {
  building: "Bâtiment",
  floor: "Étage",
  occupancy: "Occupant/Bailleur",
  council: "Conseil syndical"
};

const DIRECTORY_COLUMNS: Array<{ key: keyof DirectoryEntry; label: string; kind?: "select"; optionKey?: keyof DirectoryOptions }> = [
  { key: "id", label: "ID" },
  { key: "name", label: "Nom" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "address", label: "Adresse" },
  { key: "lot", label: "Lot" },
  { key: "building", label: "Bâtiment", kind: "select", optionKey: "building" },
  { key: "floor", label: "Étage", kind: "select", optionKey: "floor" },
  { key: "occupancy", label: "Occupant/Bailleur", kind: "select", optionKey: "occupancy" },
  { key: "council", label: "Conseil syndical", kind: "select", optionKey: "council" }
];

export function App() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([createDirectoryEntry("CP-001")]);
  const [directoryOptions, setDirectoryOptions] = useState<DirectoryOptions>(DEFAULT_DIRECTORY_OPTIONS);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [serverFilters, setServerFilters] = useState<string[]>([]);
  const [config, setConfig] = useState<AppConfig>({ propertyAddress: "", syndicName: "", filters: [FALLBACK_FILTER] });
  const [activeFilter, setActiveFilter] = useState("all");
  const [statFilter, setStatFilter] = useState<StatFilter>("active");
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [view, setView] = useState<ViewName>(viewFromHash());
  const [statusMessage, setStatusMessage] = useState("Chargement de la web app locale...");
  const [statusKind, setStatusKind] = useState<"ok" | "warn" | "">("");
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [lightbox, setLightbox] = useState<TopicDocument | null>(null);

  useEffect(() => {
    initAccessToken();
    const syncView = () => setView(viewFromHash());
    window.addEventListener("hashchange", syncView);
    void loadInitialData();
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  useEffect(() => {
    document.title = `${PAGE_TITLES[view]} — Copropro`;
  }, [view]);

  const filters = useMemo(() => {
    const available = unique([...config.filters, ...serverFilters, ...topics.map((topic) => topic.filter)]);
    return available.length ? available : [FALLBACK_FILTER];
  }, [config.filters, serverFilters, topics]);

  const visibleTopics = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return topics.filter((topic) => {
      const currentStatus = topicStatus(topic);
      const filterOk = activeFilter === "all" || topic.filter === activeFilter;
      const statOk =
        statFilter === "active"
          ? currentStatus !== "resolved"
          : statFilter === "urgent"
            ? currentStatus === "urgent"
            : statFilter === "todo"
              ? currentStatus === "todo"
              : statFilter === "partial"
                ? currentStatus === "partial"
                : statFilter === "resolved"
                  ? currentStatus === "resolved"
                  : true;
      const haystack = `${topic.title} ${topic.filter} ${topic.body} ${topic.notes} ${topic.documents
        .map((documentData) => `${documentData.label} ${documentData.href}`)
        .join(" ")}`.toLowerCase();
      return filterOk && statOk && (!needle || haystack.includes(needle));
    });
  }, [activeFilter, search, statFilter, topics]);

  const counts = useMemo(() => {
    const next: Record<StatFilter, number> = { active: 0, urgent: 0, todo: 0, partial: 0, resolved: 0 };
    topics.forEach((topic) => {
      const status = topicStatus(topic);
      if (status === "resolved") {
        next.resolved += 1;
      } else {
        next.active += 1;
        next[status] += 1;
      }
    });
    return next;
  }, [topics]);

  useEffect(() => {
    if (!directoryLoaded) return;
    const timeout = window.setTimeout(() => {
      void persistDirectory(directoryEntries, directoryOptions);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [directoryEntries, directoryLoaded, directoryOptions]);

  async function loadInitialData() {
    try {
      const nextConfig = await api.config();
      setConfig(normalizeConfig(nextConfig));
    } catch {
      setConfig({ propertyAddress: "", syndicName: "", filters: [FALLBACK_FILTER] });
    }
    try {
      const directory = await api.directory();
      const entries = (directory.entries || []).map(normalizeDirectoryEntry);
      const options = normalizeDirectoryOptions(directory.options);
      const legacyEntries = readLegacyDirectoryEntries();
      if (shouldMigrateLegacyDirectory(entries, legacyEntries)) {
        const migrated = await api.updateDirectory({ entries: legacyEntries, options });
        setDirectoryEntries((migrated.entries || []).map(normalizeDirectoryEntry));
        setDirectoryOptions(normalizeDirectoryOptions(migrated.options));
        window.localStorage.removeItem(DIRECTORY_STORAGE_KEY);
      } else {
        setDirectoryEntries(entries.length ? entries : [createDirectoryEntry("CP-001")]);
        setDirectoryOptions(options);
      }
      setDirectoryLoaded(true);
    } catch (error) {
      setDirectoryEntries(readLegacyDirectoryEntries());
      setDirectoryOptions(DEFAULT_DIRECTORY_OPTIONS);
      setDirectoryLoaded(true);
      setStatusMessage(error instanceof Error ? error.message : "Impossible de charger Contents/Annuaire/annuaireCopropriétaires.md.");
      setStatusKind("warn");
    }
    try {
      const payload = await api.topics();
      setTopics((payload.topics || []).map(normalizeTopic).sort(topicSort));
      setServerFilters(payload.filters || []);
      setStatusMessage("Web app locale connectée. Les sujets et documents sont enregistrés sur ce serveur.");
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Serveur local indisponible. Lancez la web app avec npm start.");
      setStatusKind("warn");
    }
  }

  async function persistConfig(nextConfig: AppConfig) {
    try {
      const saved = await api.updateConfig(normalizeConfig(nextConfig));
      setConfig(normalizeConfig(saved));
      setStatusMessage("Configuration enregistrée dans assets/config.md.");
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible d'écrire assets/config.md.");
      setStatusKind("warn");
    }
  }

  async function persistDirectory(entries: DirectoryEntry[], options: DirectoryOptions) {
    try {
      await api.updateDirectory({ entries: entries.map(normalizeDirectoryEntry), options: normalizeDirectoryOptions(options) });
      setStatusMessage("Annuaire enregistré dans Contents/Annuaire/annuaireCopropriétaires.md.");
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible d'écrire Contents/Annuaire/annuaireCopropriétaires.md.");
      setStatusKind("warn");
    }
  }

  async function saveTopic(topic: Topic) {
    try {
      const next = { ...topic, status: topicStatus(topic) };
      const payload = await api.updateTopic(next);
      replaceTopic(payload.topic);
      setServerFilters(payload.filters || serverFilters);
      setStatusMessage(`Markdown mis à jour : ${payload.topic.sourceFile}`);
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible d'écrire le fichier Markdown.");
      setStatusKind("warn");
    }
  }

  function replaceTopic(topic: Topic) {
    setTopics((current) => {
      const normalized = normalizeTopic(topic);
      const index = current.findIndex((item) => item.id === normalized.id);
      const next = index >= 0 ? current.map((item) => (item.id === normalized.id ? normalized : item)) : [...current, normalized];
      return next.sort(topicSort);
    });
  }

  async function deleteTopic(topic: Topic) {
    if (!window.confirm(`Supprimer le sujet "${topic.title}" ?`)) return;
    try {
      await api.deleteTopic(topic.id);
      setTopics((current) => current.filter((item) => item.id !== topic.id));
      setStatusMessage(`Sujet supprimé : ${topic.title}`);
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible de supprimer ce sujet.");
      setStatusKind("warn");
    }
  }

  async function addFilter() {
    const name = text(window.prompt("Nom du nouveau filtre") || "");
    if (!name) return;
    if (filters.includes(name)) {
      setActiveFilter(name);
      return;
    }
    try {
      const payload = await api.createFilter(name);
      setConfig((current) => ({ ...current, filters: payload.filters || [...current.filters, name] }));
      setServerFilters(payload.filters || serverFilters);
      setActiveFilter(name);
      setStatusMessage(`Filtre ajouté : ${name}`);
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible de créer le filtre.");
      setStatusKind("warn");
    }
  }

  async function renameFilter(oldName: string) {
    const name = text(window.prompt("Nouveau nom du filtre", oldName) || "");
    if (!name || name === oldName) return;
    try {
      const payload = await api.renameFilter(oldName, name);
      setTopics((payload.topics || []).map(normalizeTopic).sort(topicSort));
      setConfig((current) => ({ ...current, filters: payload.filters || current.filters.map((filter) => (filter === oldName ? name : filter)) }));
      setServerFilters(payload.filters || serverFilters.map((filter) => (filter === oldName ? name : filter)));
      if (activeFilter === oldName) setActiveFilter(name);
      setStatusMessage(`Filtre renommé : ${name}`);
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible de renommer le filtre.");
      setStatusKind("warn");
    }
  }

  async function removeFilter(name: string) {
    if (topics.some((topic) => topic.filter === name)) {
      setStatusMessage("Ce filtre contient des sujets. Déplacez ou supprimez les sujets avant de supprimer le filtre.");
      setStatusKind("warn");
      return;
    }
    try {
      const payload = await api.deleteFilter(name);
      setConfig((current) => ({ ...current, filters: payload.filters || current.filters.filter((filter) => filter !== name) }));
      setServerFilters(payload.filters || serverFilters.filter((filter) => filter !== name));
      if (activeFilter === name) setActiveFilter("all");
      setStatusMessage(`Filtre supprimé : ${name}`);
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible de supprimer ce filtre.");
      setStatusKind("warn");
    }
  }

  async function addAttachments(topic: Topic, files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const oversized = selected.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      setStatusMessage(`Fichier trop volumineux : ${oversized.name}. Taille maximale : ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      setStatusKind("warn");
      return;
    }
    const formData = new FormData();
    selected.forEach((file) => formData.append("files", file));
    try {
      const payload = await api.addAttachments(topic.id, formData);
      replaceTopic(payload.topic);
      setStatusMessage("Pièce jointe enregistrée dans Documents/Incidents.");
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible d'ajouter la pièce jointe.");
      setStatusKind("warn");
    }
  }

  async function removeAttachment(topic: Topic, index: number) {
    try {
      const payload = await api.removeAttachment(topic.id, index);
      replaceTopic(payload.topic);
      setStatusMessage("Pièce jointe retirée du sujet. Le fichier reste dans Documents/Incidents.");
      setStatusKind("ok");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Impossible de retirer cette pièce jointe.");
      setStatusKind("warn");
    }
  }

  const groupedTopics = useMemo(() => {
    const grouped = new Map<string, Topic[]>();
    visibleTopics.forEach((topic) => {
      if (!grouped.has(topic.filter)) grouped.set(topic.filter, []);
      grouped.get(topic.filter)?.push(topic);
    });
    return grouped;
  }, [visibleTopics]);

  return (
    <div className="app-shell" data-view={view} data-edit-mode={editMode ? "true" : "false"}>
      <Sidebar view={view} />
      <main className="app-main">
        <Header
          view={view}
          config={config}
          editMode={editMode}
          search={search}
          onSearch={setSearch}
          onEditToggle={() => setEditMode((value) => !value)}
          onConfigChange={(nextConfig) => {
            setConfig(nextConfig);
            void persistConfig(nextConfig);
          }}
        />

        {view === "incidents" ? (
          <>
            <section className="stats-grid" aria-label="Statistiques des incidents">
              {STATUS_CARDS.map((card) => (
                <button
                  key={card.id}
                  className={`stat-card ${statFilter === card.id ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={statFilter === card.id}
                  onClick={() => setStatFilter(card.id)}
                >
                  <span className="stat-icon">
                    <AppIcon name={card.icon} />
                  </span>
                  <strong className={`stat-num ${card.countKey}`}>{counts[card.countKey]}</strong>
                  <span>{card.label}</span>
                </button>
              ))}
            </section>

            {editMode ? (
              <div className="edit-banner" role="status">
                Mode édition actif — les changements sont enregistrés dans Contents/Incidents et Documents/Incidents.
              </div>
            ) : null}

            <p className={`content-status ${statusKind}`} aria-live="polite">
              {statusMessage}
            </p>

            <section className="controls-bar">
              <Button onClick={() => setNewDialogOpen(true)}>
                <span data-icon="inline-start">+</span> Nouveau Sujet
              </Button>
              <div className="filter-tabs" aria-label="Filtres">
                <button className={`filter-tab ${activeFilter === "all" ? "is-active" : ""}`} type="button" onClick={() => setActiveFilter("all")}>
                  Tous les sujets
                </button>
                {filters.map((filter) => (
                  <span className={`filter-tab filter-tab-managed ${activeFilter === filter ? "is-active" : ""}`} key={filter}>
                    <button type="button" onClick={() => setActiveFilter(filter)}>
                      {filter}
                    </button>
                    {editMode ? (
                      <>
                        <button className="filter-icon-btn" type="button" title="Renommer ce filtre" onClick={() => void renameFilter(filter)}>
                          <AppIcon name="edit" />
                        </button>
                        <button className="filter-icon-btn" type="button" title="Supprimer ce filtre" onClick={() => void removeFilter(filter)}>
                          ×
                        </button>
                      </>
                    ) : null}
                  </span>
                ))}
                {editMode ? (
                  <button className="filter-add" type="button" onClick={() => void addFilter()}>
                    + Ajouter un filtre
                  </button>
                ) : null}
              </div>
            </section>

            <section className="dashboard-layout">
              <div className="topics-section">
                {!groupedTopics.size ? (
                  <Empty>
                    <h3>{search ? "Aucun sujet ne correspond à la recherche" : "Aucun sujet trouvé"}</h3>
                    <p>{search ? "Essayez un autre mot-clé ou effacez la recherche." : "Modifiez vos critères ou créez un sujet."}</p>
                  </Empty>
                ) : (
                  Array.from(groupedTopics.entries()).map(([filter, list]) => (
                    <section className="category-group" key={filter}>
                      <h2 className="category-title">{filter}</h2>
                      {list.map((topic) => (
                        <TopicCard
                          key={topic.id}
                          topic={topic}
                          editMode={editMode}
                          onSave={saveTopic}
                          onDelete={deleteTopic}
                          onAddAttachments={addAttachments}
                          onRemoveAttachment={removeAttachment}
                          onPreview={setLightbox}
                        />
                      ))}
                    </section>
                  ))
                )}
              </div>
              <DocumentExplorer topics={visibleTopics} filters={filters} onPreview={setLightbox} />
            </section>
          </>
        ) : view === "directory" ? (
          <DirectoryPage
            entries={directoryEntries}
            search={search}
            editMode={editMode}
            directoryOptions={directoryOptions}
            onEntriesChange={setDirectoryEntries}
            onDirectoryOptionsChange={(directoryOptions) => {
              setDirectoryOptions(directoryOptions);
            }}
          />
        ) : (
          <PlaceholderPage view={view} />
        )}
      </main>

      <NewTopicDialog
        open={newDialogOpen}
        filters={filters}
        defaultFilter={filters[0] || FALLBACK_FILTER}
        onClose={() => setNewDialogOpen(false)}
        onCreate={async (topic) => {
          const payload = await api.createTopic(topic);
          replaceTopic(payload.topic);
          setServerFilters(payload.filters || serverFilters);
          setNewDialogOpen(false);
          setStatusMessage(`Sujet créé : ${payload.topic.sourceFile}`);
          setStatusKind("ok");
        }}
        onError={(message) => {
          setStatusMessage(message);
          setStatusKind("warn");
        }}
      />

      <Dialog open={Boolean(lightbox)} title={lightbox?.label || "Document visuel"} onOpenChange={() => setLightbox(null)} className="lightbox-dialog">
        {lightbox ? (
          <>
            <div className="lightbox-header">
              <strong>{lightbox.label || "Image"}</strong>
              <Button variant="ghost" size="icon" onClick={() => setLightbox(null)} aria-label="Fermer">
                ×
              </Button>
            </div>
            <img src={documentHref(lightbox.href)} alt={lightbox.label || "Document visuel"} />
            <p>{lightbox.description || lightbox.href}</p>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}

function Header({
  view,
  config,
  editMode,
  search,
  onSearch,
  onEditToggle,
  onConfigChange
}: {
  view: ViewName;
  config: AppConfig;
  editMode: boolean;
  search: string;
  onSearch: (value: string) => void;
  onEditToggle: () => void;
  onConfigChange: (config: AppConfig) => void;
}) {
  const [draftAddress, setDraftAddress] = useState(config.propertyAddress);
  const [draftSyndic, setDraftSyndic] = useState(config.syndicName);

  useEffect(() => {
    setDraftAddress(config.propertyAddress);
    setDraftSyndic(config.syndicName);
  }, [config.propertyAddress, config.syndicName]);

  return (
    <header className="app-header">
      <div>
        <h1>{PAGE_TITLES[view]}</h1>
        {editMode ? (
          <div className="header-config-edit">
            <Input value={draftAddress} onChange={(event) => setDraftAddress(event.target.value)} onBlur={() => onConfigChange({ ...config, propertyAddress: draftAddress })} aria-label="Adresse de la copropriété" />
            <Input value={draftSyndic} onChange={(event) => setDraftSyndic(event.target.value)} onBlur={() => onConfigChange({ ...config, syndicName: draftSyndic })} aria-label="Nom du syndic" />
          </div>
        ) : (
          <p>
            <AppIcon name="map-pin" />
            {[config.propertyAddress, config.syndicName].filter(Boolean).join(" — ") || "Adresse — Syndic"}
          </p>
        )}
      </div>
      <div className="header-actions">
        <label className="search-box">
          <AppIcon name="search" />
          <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Rechercher un sujet, mot-clé, document..." aria-label="Rechercher un sujet, mot-clé ou document" />
        </label>
        <Button variant="outline" size="icon" type="button" aria-label={editMode ? "Quitter l'édition" : "Éditer le texte"} title={editMode ? "Quitter l'édition" : "Éditer le texte"} onClick={onEditToggle}>
          <AppIcon name={editMode ? "save" : "edit"} />
        </Button>
      </div>
    </header>
  );
}

function TopicCard({
  topic,
  editMode,
  onSave,
  onDelete,
  onAddAttachments,
  onRemoveAttachment,
  onPreview
}: {
  topic: Topic;
  editMode: boolean;
  onSave: (topic: Topic) => Promise<void>;
  onDelete: (topic: Topic) => Promise<void>;
  onAddAttachments: (topic: Topic, files: FileList | null) => Promise<void>;
  onRemoveAttachment: (topic: Topic, index: number) => Promise<void>;
  onPreview: (documentData: TopicDocument) => void;
}) {
  const status = topicStatus(topic);
  const [draft, setDraft] = useState(topic);

  useEffect(() => {
    setDraft(topic);
  }, [topic]);

  const commit = (patch: Partial<Topic>) => {
    const next = normalizeTopic({ ...draft, ...patch });
    setDraft(next);
    void onSave(next);
  };

  return (
    <Card className={`topic-card status-${status} ${editMode ? "is-editing" : ""}`}>
      <CardHeader>
        {editMode ? (
          <>
            <div className="card-title-group">
              <span className="location-tag">{topic.filter}</span>
              {topic.createdAt ? (
                <span className="topic-created-date">
                  <AppIcon name="calendar" /> {formatDate(topic.createdAt)}
                </span>
              ) : null}
            </div>
            <div className="card-meta-badges">
              <Badge className={`badge-${status}`}>{badgeText(status)}</Badge>
              <Button variant="danger" size="sm" type="button" onClick={() => void onDelete(topic)}>
                Supprimer
              </Button>
            </div>
            <Input
              className="topic-title-input"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              onBlur={() => commit({ title: draft.title })}
              aria-label="Titre du sujet"
            />
          </>
        ) : (
          <>
            <div className="card-title-group">
              <span className="location-tag">{topic.filter}</span>
              <CardTitle>{topic.title}</CardTitle>
              {topic.createdAt ? (
                <span className="topic-created-date">
                  <AppIcon name="calendar" /> {formatDate(topic.createdAt)}
                </span>
              ) : null}
            </div>
            <div className="card-meta-badges">
              <Badge className={`badge-${status}`}>{badgeText(status)}</Badge>
            </div>
          </>
        )}
      </CardHeader>
      <CardContent>
        {editMode ? (
          <Textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} onBlur={() => commit({ body: draft.body })} aria-label="Contexte du sujet" rows={5} />
        ) : (
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(topic.body) }} />
        )}

        <section className="topic-block">
          <h4>
            <AppIcon name="action" /> Proposition d'Action
          </h4>
          <div className="action-list">
            {draft.actions.map((action, index) => (
              <ActionRow
                key={`${topic.id}-action-${index}`}
                topic={draft}
                action={action}
                index={index}
                editMode={editMode}
                onChange={(actions) => commit({ actions })}
              />
            ))}
          </div>
          {editMode ? (
            <Button variant="outline" size="sm" type="button" onClick={() => commit({ actions: [...draft.actions, { text: "Nouvelle action à préciser", done: false }] })}>
              + Ajouter une action
            </Button>
          ) : null}
        </section>

        <NotesBlock topic={draft} editMode={editMode} onChange={(notes) => commit({ notes })} />

        {(editMode || topic.documents.length) && (
          <section className="topic-block documents-block">
            <h4>
              <AppIcon name="paperclip" /> Documents associés
            </h4>
            {editMode ? (
              <label className="attachment-upload-btn">
                + Ajouter une pièce jointe
                <input type="file" multiple onChange={(event) => void onAddAttachments(topic, event.target.files)} />
              </label>
            ) : null}
            <div className="document-list">
              {topic.documents.length ? (
                topic.documents.map((documentData, index) => (
                  <DocumentLink
                    key={`${documentData.href}-${index}`}
                    documentData={documentData}
                    onPreview={onPreview}
                    trailing={
                      editMode ? (
                        <button className="attachment-remove-btn" type="button" onClick={() => void onRemoveAttachment(topic, index)} aria-label="Retirer cette pièce jointe">
                          ×
                        </button>
                      ) : null
                    }
                  />
                ))
              ) : (
                <span className="muted">{editMode ? "Aucune pièce jointe. Utilisez le bouton pour en ajouter une." : "Aucun document associé."}</span>
              )}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function ActionRow({
  topic,
  action,
  index,
  editMode,
  onChange
}: {
  topic: Topic;
  action: TopicAction;
  index: number;
  editMode: boolean;
  onChange: (actions: TopicAction[]) => void;
}) {
  const [draftText, setDraftText] = useState(action.text);
  useEffect(() => setDraftText(action.text), [action.text]);
  const labelId = `action-text-${topic.id}-${index}`;
  const update = (patch: Partial<TopicAction>) => {
    const actions = topic.actions.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    onChange(actions.length ? actions : [{ text: "Nouvelle action à préciser", done: false }]);
  };
  return (
    <div className="action-row">
      <input type="checkbox" checked={action.done} onChange={(event) => update({ done: event.target.checked })} aria-labelledby={labelId} />
      {editMode ? (
        <Input
          id={labelId}
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          onBlur={() => update({ text: text(draftText) || "Nouvelle action à préciser" })}
          aria-label="Action à réaliser"
        />
      ) : (
        <span id={labelId}>{action.text}</span>
      )}
      {editMode ? (
        <button className="remove-row-btn" type="button" onClick={() => onChange(topic.actions.filter((_, itemIndex) => itemIndex !== index))} aria-label="Supprimer cette action">
          ×
        </button>
      ) : null}
    </div>
  );
}

function NotesBlock({ topic, editMode, onChange }: { topic: Topic; editMode: boolean; onChange: (notes: string) => void }) {
  const entries = parseNoteEntries(topic);
  const [draftEntries, setDraftEntries] = useState(entries);
  useEffect(() => setDraftEntries(entries), [topic.notes]);
  const updateEntry = (index: number, value: string) => {
    const next = draftEntries.map((entry, itemIndex) => (itemIndex === index ? { ...entry, text: value } : entry));
    setDraftEntries(next);
  };
  const commitEntry = (index: number, value: string) => {
    const next = draftEntries.map((entry, itemIndex) => (itemIndex === index ? { ...entry, text: value } : entry));
    onChange(serializeNoteEntries(next));
  };
  return (
    <section className="topic-block notes-block">
      <h4>
        <AppIcon name="note" /> Notes de Suivi
      </h4>
      {draftEntries.length ? (
        draftEntries.map((entry, index) => (
          <div className="note-row" key={`${entry.date}-${index}`}>
            <span>{formatDate(entry.date)}</span>
            {editMode ? (
              <Input
                value={entry.text}
                onChange={(event) => updateEntry(index, event.target.value)}
                onBlur={(event) => commitEntry(index, event.target.value)}
                aria-label="Note de suivi"
              />
            ) : (
              <p>{entry.text}</p>
            )}
            {editMode ? (
              <button className="remove-row-btn" type="button" onClick={() => onChange(serializeNoteEntries(draftEntries.filter((_, itemIndex) => itemIndex !== index)))} aria-label="Supprimer cette note">
                ×
              </button>
            ) : null}
          </div>
        ))
      ) : (
        <p className="muted">{editMode ? "Aucune note de suivi. Utilisez le bouton pour en ajouter une." : "Aucune note de suivi."}</p>
      )}
      {editMode ? (
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => onChange(serializeNoteEntries([...draftEntries, { date: todayIso(), text: "Nouvelle note de suivi à préciser" }]))}
        >
          + Ajouter une note
        </Button>
      ) : null}
    </section>
  );
}

function DocumentExplorer({ topics, filters, onPreview }: { topics: Topic[]; filters: string[]; onPreview: (documentData: TopicDocument) => void }) {
  const docs = topics.flatMap((topic) => topic.documents.map((documentData) => ({ topic, documentData })));
  if (!docs.length) {
    return (
      <aside className="document-explorer">
        <h3>Explorateur de Documents</h3>
        <p className="muted">Aucun document associé.</p>
      </aside>
    );
  }
  const years = unique([String(new Date().getFullYear()), ...docs.map(({ topic, documentData }) => documentYear(documentData.href, topic))]).sort((a, b) =>
    b.localeCompare(a, "fr", { numeric: true })
  );

  return (
    <aside className="document-explorer">
      <h3>Explorateur de Documents</h3>
      <div className="document-tree">
        {years.map((year) => {
          const yearDocs = docs.filter(({ topic, documentData }) => documentYear(documentData.href, topic) === year);
          return (
            <details open key={year}>
              <summary>
                <AppIcon name="folder" /> {year}
              </summary>
              {filters.map((filter) => {
                const related = yearDocs.filter((item) => item.topic.filter === filter && !isArchivedDocument(item.documentData, docs));
                if (!related.length) return null;
                return (
                  <details open key={`${year}-${filter}`}>
                    <summary>
                      <AppIcon name="folder" /> {filter}
                    </summary>
                    <div className="document-list tree-list">
                      {related.map(({ documentData }, index) => (
                        <DocumentLink key={`${documentData.href}-${index}`} documentData={documentData} onPreview={onPreview} />
                      ))}
                    </div>
                  </details>
                );
              })}
              {yearDocs.some((item) => isArchivedDocument(item.documentData, docs)) ? (
                <details open>
                  <summary>
                    <AppIcon name="archive" /> Archives
                  </summary>
                  <div className="document-list tree-list">
                    {yearDocs
                      .filter((item) => isArchivedDocument(item.documentData, docs))
                      .map(({ documentData }, index) => (
                        <DocumentLink key={`${documentData.href}-archive-${index}`} documentData={documentData} onPreview={onPreview} />
                      ))}
                  </div>
                </details>
              ) : null}
            </details>
          );
        })}
      </div>
    </aside>
  );
}

function DocumentLink({
  documentData,
  onPreview,
  trailing
}: {
  documentData: TopicDocument;
  onPreview: (documentData: TopicDocument) => void;
  trailing?: ReactNode;
}) {
  const icon = documentData.type === "image" ? "image" : /\.(eml|msg)$/i.test(documentData.href || "") ? "mail" : "file";
  const isImage = documentData.type === "image";
  return (
    <span className="document-item">
      <a
        href={documentHref(documentData.href)}
        target="_blank"
        rel="noopener"
        onClick={(event) => {
          if (!isImage) return;
          event.preventDefault();
          onPreview(documentData);
        }}
      >
        <AppIcon name={icon} /> {documentData.label || documentData.href}
      </a>
      {trailing}
    </span>
  );
}

function NewTopicDialog({
  open,
  filters,
  defaultFilter,
  onClose,
  onCreate,
  onError
}: {
  open: boolean;
  filters: string[];
  defaultFilter: string;
  onClose: () => void;
  onCreate: (topic: Partial<Topic>) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [filter, setFilter] = useState(defaultFilter);
  const [status, setStatus] = useState<TopicStatus>("todo");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [actions, setActions] = useState<TopicAction[]>([{ text: "", done: false }]);

  useEffect(() => {
    if (!open) return;
    setFilter(defaultFilter);
    setStatus("todo");
    setTitle("");
    setBody("");
    setActions([{ text: "", done: false }]);
  }, [defaultFilter, open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await onCreate({
        filter,
        status,
        title: text(title) || "Nouveau sujet",
        body: text(body) || "Contexte à compléter.",
        actions: normalizeActions(actions.map((action) => ({ ...action, text: text(action.text) })).filter((action) => action.text))
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Impossible de créer le sujet.");
    }
  }

  return (
    <Dialog open={open} title="Nouveau sujet" onOpenChange={(next) => !next && onClose()}>
      <form className="new-topic-form" onSubmit={submit}>
        <h2>Nouveau sujet</h2>
        <div className="field-row">
          <Label>
            Filtre
            <select value={filter} onChange={(event) => setFilter(event.target.value)} required>
              {filters.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Label>
          <Label>
            Statut
            <select value={status} onChange={(event) => setStatus(event.target.value as TopicStatus)}>
              <option value="todo">À traiter</option>
              <option value="urgent">Urgent / Critique</option>
              <option value="partial">Partiellement traité</option>
              <option value="resolved">Traité</option>
            </select>
          </Label>
        </div>
        <Label>
          Titre
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex. Nouveau dossier à suivre" required />
        </Label>
        <Label>
          Contexte
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Décrivez le contexte du sujet..." rows={6} />
        </Label>
        <div className="new-topic-actions-block">
          <div className="new-topic-actions-header">
            <span>Proposition d'Action</span>
            <Button variant="outline" size="sm" type="button" onClick={() => setActions((current) => [...current, { text: "", done: false }])}>
              + Ajouter
            </Button>
          </div>
          {actions.map((action, index) => (
            <div className="new-topic-action-row" key={index}>
              <Input
                value={action.text}
                onChange={(event) => setActions((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, text: event.target.value } : item)))}
                placeholder="Action à réaliser"
              />
              <button className="remove-row-btn" type="button" onClick={() => setActions((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Supprimer cette proposition">
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit">Créer le sujet</Button>
        </div>
      </form>
    </Dialog>
  );
}

function DirectoryPage({
  entries,
  search,
  editMode,
  directoryOptions,
  onEntriesChange,
  onDirectoryOptionsChange
}: {
  entries: DirectoryEntry[];
  search: string;
  editMode: boolean;
  directoryOptions: DirectoryOptions;
  onEntriesChange: (entries: DirectoryEntry[]) => void;
  onDirectoryOptionsChange: (options: DirectoryOptions) => void;
}) {
  const needle = search.toLowerCase().trim();
  const normalizedOptions = normalizeDirectoryOptions(directoryOptions);
  const rows = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !needle || Object.values(entry).join(" ").toLowerCase().includes(needle));

  const updateEntry = (index: number, key: keyof DirectoryEntry, value: string) => {
    onEntriesChange(entries.map((entry, itemIndex) => (itemIndex === index ? { ...entry, [key]: value } : entry)));
  };

  const addEntry = () => {
    onEntriesChange([...entries, createDirectoryEntry(nextDirectoryId(entries))]);
  };

  const removeEntry = (index: number) => {
    onEntriesChange(entries.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateOption = (key: keyof DirectoryOptions, optionIndex: number, value: string) => {
    const nextValues = normalizedOptions[key].map((option, index) => (index === optionIndex ? value : option));
    onDirectoryOptionsChange({ ...normalizedOptions, [key]: unique(nextValues.map(text)).filter(Boolean) });
  };

  const addOption = (key: keyof DirectoryOptions, labelValue: string) => {
    const label = text(labelValue);
    if (!label) return;
    onDirectoryOptionsChange({ ...normalizedOptions, [key]: unique([...normalizedOptions[key], label]).filter(Boolean) });
  };

  const removeOption = (key: keyof DirectoryOptions, optionIndex: number) => {
    onDirectoryOptionsChange({ ...normalizedOptions, [key]: normalizedOptions[key].filter((_, index) => index !== optionIndex) });
  };

  return (
    <section className="directory-page">
      <div className="directory-title-row">
        <h2>Annuaire des Copropriétaires</h2>
        <Button type="button" onClick={addEntry}>
          + Ajouter une ligne
        </Button>
      </div>
      {editMode ? (
        <div className="edit-banner" role="status">
          Mode édition actif — les choix de l'annuaire sont enregistrés dans assets/config.md.
        </div>
      ) : null}
      <div className="directory-table-wrap">
        <table className="directory-table">
          <thead>
            <tr>
              {DIRECTORY_COLUMNS.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              {editMode ? <th>Supprimer</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entry, index }) => (
              <tr key={`${entry.id}-${index}`}>
                {DIRECTORY_COLUMNS.map((column) => (
                  <td data-label={column.label} key={column.key}>
                    {column.kind === "select" && editMode ? (
                      <select
                        value={entry[column.key]}
                        onChange={(event) => updateEntry(index, column.key, event.target.value)}
                        aria-label={`${column.label} ligne ${index + 1}`}
                      >
                        {selectOptions(normalizedOptions[column.optionKey || "building"], entry[column.key]).map((option) => (
                          <option value={option} key={option || "empty"}>
                            {option || "Non renseigné"}
                          </option>
                        ))}
                      </select>
                    ) : column.kind === "select" ? (
                      <span className="directory-cell-text">{entry[column.key] || "Non renseigné"}</span>
                    ) : editMode ? (
                      <Textarea
                        className="directory-textarea"
                        value={entry[column.key]}
                        onChange={(event) => updateEntry(index, column.key, event.target.value)}
                        aria-label={`${column.label} ligne ${index + 1}`}
                        rows={directoryFieldRows(entry[column.key])}
                        style={{ width: directoryFieldWidth(entry[column.key], column.key) }}
                      />
                    ) : (
                      <span className="directory-cell-text">{entry[column.key] || "Non renseigné"}</span>
                    )}
                  </td>
                ))}
                {editMode ? (
                  <td className="directory-delete-cell" data-label="Supprimer">
                    <button className="remove-row-btn" type="button" onClick={() => removeEntry(index)} aria-label={`Supprimer la ligne ${index + 1}`}>
                      ×
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <Empty className="directory-empty">
            <h3>Aucun copropriétaire ne correspond à la recherche</h3>
            <p>Effacez la recherche ou ajoutez une nouvelle ligne.</p>
          </Empty>
        ) : null}
      </div>
      {editMode ? (
        <section className="directory-options-panel" aria-label="Choix de l'annuaire">
          <h3>Choix de l'annuaire</h3>
          <div className="directory-options-grid">
            {(Object.keys(DIRECTORY_OPTION_LABELS) as Array<keyof DirectoryOptions>).map((key) => (
              <div className="directory-option-group" key={key}>
                <div className="directory-option-heading">
                  <h4>{DIRECTORY_OPTION_LABELS[key]}</h4>
                </div>
                <div className="directory-option-list">
                  {normalizedOptions[key].map((option, optionIndex) => (
                    <div className="directory-option-row" key={`${key}-${option}-${optionIndex}`}>
                      <Input
                        value={option}
                        onChange={(event) => updateOption(key, optionIndex, event.target.value)}
                        aria-label={`${DIRECTORY_OPTION_LABELS[key]} choix ${optionIndex + 1}`}
                      />
                      <button className="remove-row-btn" type="button" onClick={() => removeOption(key, optionIndex)} aria-label={`Supprimer le choix ${option}`}>
                        ×
                      </button>
                    </div>
                  ))}
                  {!normalizedOptions[key].length ? <p className="muted">Aucun choix configuré.</p> : null}
                  <form
                    className="directory-option-row directory-option-add-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      addOption(key, new FormData(form).get("choice")?.toString() || "");
                      form.reset();
                    }}
                  >
                    <Input
                      name="choice"
                      aria-label={`Nouveau choix ${DIRECTORY_OPTION_LABELS[key]}`}
                      placeholder="Nouveau choix"
                    />
                    <Button variant="outline" size="sm" type="submit" aria-label={`Ajouter un choix ${DIRECTORY_OPTION_LABELS[key]}`}>
                      Ajouter
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

function PlaceholderPage({ view }: { view: ViewName }) {
  const isDirectory = view === "directory";
  return (
    <section className="placeholder-page">
      <p>{isDirectory ? "Cette page regroupera l'annuaire des copropriétaires." : "Cette page regroupera les informations et documents liés aux contrats de copropriété."}</p>
      <Empty>
        <h2>{isDirectory ? "Annuaire des copropriétaires" : "Contrats"}</h2>
        <p>{isDirectory ? "Aucun contact n'est encore enregistré dans cette version locale." : "Aucun contrat n'est encore enregistré dans cette version locale."}</p>
      </Empty>
    </section>
  );
}

function viewFromHash(): ViewName {
  if (window.location.hash === "#annuaire") return "directory";
  if (window.location.hash === "#contrat") return "contract";
  return "incidents";
}

function normalizeConfig(config: Partial<AppConfig>): AppConfig {
  const filters = unique(Array.isArray(config.filters) ? config.filters : []);
  return {
    propertyAddress: text(config.propertyAddress),
    syndicName: text(config.syndicName),
    filters: filters.length ? filters : [FALLBACK_FILTER]
  };
}

function normalizeDirectoryOptions(options?: Partial<DirectoryOptions>): DirectoryOptions {
  return {
    building: normalizeOptionList(options?.building, DEFAULT_DIRECTORY_OPTIONS.building),
    floor: normalizeOptionList(options?.floor, DEFAULT_DIRECTORY_OPTIONS.floor),
    occupancy: normalizeOptionList(options?.occupancy, DEFAULT_DIRECTORY_OPTIONS.occupancy),
    council: normalizeOptionList(options?.council, DEFAULT_DIRECTORY_OPTIONS.council)
  };
}

function normalizeOptionList(values: unknown, fallback: string[]) {
  const normalized = unique((Array.isArray(values) ? values : fallback).map(text)).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function selectOptions(options: string[], currentValue: string) {
  return unique(["", ...options, text(currentValue)]);
}

function directoryFieldRows(value: string) {
  return Math.min(6, Math.max(2, String(value || "").split(/\r?\n/).length));
}

function directoryFieldWidth(value: string, key: keyof DirectoryEntry) {
  const minimums: Partial<Record<keyof DirectoryEntry, number>> = {
    id: 9,
    name: 14,
    email: 18,
    phone: 14,
    address: 22,
    lot: 10
  };
  const maximums: Partial<Record<keyof DirectoryEntry, number>> = {
    id: 16,
    name: 28,
    email: 34,
    phone: 22,
    address: 42,
    lot: 18
  };
  const longestLine = String(value || "")
    .split(/\r?\n/)
    .reduce((max, line) => Math.max(max, line.length), 0);
  const min = minimums[key] || 12;
  const max = maximums[key] || 30;
  return `${Math.min(max, Math.max(min, longestLine + 3))}ch`;
}

function createDirectoryEntry(id: string): DirectoryEntry {
  return {
    id,
    name: "",
    email: "",
    phone: "",
    address: "",
    lot: "",
    building: "",
    floor: "",
    occupancy: "",
    council: ""
  };
}

function nextDirectoryId(entries: DirectoryEntry[]) {
  const next = entries.reduce((max, entry) => {
    const match = String(entry.id || "").match(/(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `CP-${String(next).padStart(3, "0")}`;
}

function readLegacyDirectoryEntries(): DirectoryEntry[] {
  try {
    const raw = window.localStorage.getItem(DIRECTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.map(normalizeDirectoryEntry);
  } catch {
    // L'annuaire reste utilisable même si le stockage local est indisponible.
  }
  return [createDirectoryEntry("CP-001")];
}

function shouldMigrateLegacyDirectory(entries: DirectoryEntry[], legacyEntries: DirectoryEntry[]) {
  const serverHasOnlyBlankDefault = entries.length === 1 && isBlankDirectoryEntry(entries[0]);
  return serverHasOnlyBlankDefault && legacyEntries.some((entry) => !isBlankDirectoryEntry(entry));
}

function isBlankDirectoryEntry(entry: DirectoryEntry) {
  const normalized = normalizeDirectoryEntry(entry);
  return Object.entries(normalized).every(([key, value]) => key === "id" || !text(value)) && normalized.id === "CP-001";
}

function normalizeDirectoryEntry(entry: Partial<DirectoryEntry>): DirectoryEntry {
  return {
    id: text(entry.id) || "CP-001",
    name: text(entry.name),
    email: text(entry.email),
    phone: text(entry.phone),
    address: text(entry.address),
    lot: text(entry.lot),
    building: text(entry.building),
    floor: text(entry.floor),
    occupancy: text(entry.occupancy),
    council: text(entry.council)
  };
}

function isArchivedDocument(documentData: TopicDocument, docs: Array<{ topic: Topic; documentData: TopicDocument }>) {
  const href = documentData.href || "";
  if (!href) return false;
  return !docs.some((item) => item.documentData.href === href && topicStatus(item.topic) !== "resolved");
}
