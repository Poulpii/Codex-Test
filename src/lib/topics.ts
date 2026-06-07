import type { Topic, TopicAction, TopicStatus } from "../types";
import { escapeHtml, text, todayIso } from "./utils";

const TOPIC_STATUSES = new Set<TopicStatus>(["urgent", "todo", "partial", "resolved"]);

export function normalizeActions(actions: unknown): TopicAction[] {
  if (!Array.isArray(actions) || !actions.length) return [{ text: "Nouvelle action à préciser", done: false }];
  return actions.map((action) => {
    if (typeof action === "string") return { text: action || "Nouvelle action à préciser", done: false };
    const item = action as Partial<TopicAction>;
    return { text: item.text || "Nouvelle action à préciser", done: Boolean(item.done) };
  });
}

export function normalizeTopic(topic: Partial<Topic>): Topic {
  const filter = topic.filter || topic.folder || "Filtre";
  return {
    id: topic.id || `topic-${Date.now()}`,
    title: topic.title || "Nouveau sujet",
    createdAt: topic.createdAt || "",
    filter,
    folder: topic.folder || filter,
    priority: topic.priority === "urgent" || topic.status === "urgent" ? "urgent" : "",
    status: topicStatus(topic),
    sourceFile: topic.sourceFile || `${topic.id || Date.now()}.md`,
    body: topic.body || "Contexte à compléter.",
    notes: topic.notes || "",
    documents: Array.isArray(topic.documents) ? topic.documents : [],
    actions: normalizeActions(topic.actions)
  };
}

export function topicStatus(topic: Partial<Topic>): TopicStatus {
  const actions = Array.isArray(topic.actions) ? topic.actions : [];
  const done = actions.filter((action) => action.done).length;
  if (done && done === actions.length) return "resolved";
  if (topic.priority === "urgent" || topic.status === "urgent") return "urgent";
  if (done) return "partial";
  if (topic.status === "resolved" || topic.status === "partial") return "todo";
  return TOPIC_STATUSES.has(topic.status as TopicStatus) ? (topic.status as TopicStatus) : "todo";
}

export function topicNumber(topic: Topic) {
  const id = String(topic.id || "");
  if (/^\d{4}$/.test(id)) return Number(id);
  const sourceMatch = String(topic.sourceFile || "").match(/^(\d{4})[-_]/);
  if (sourceMatch) return Number(sourceMatch[1]);
  const titleMatch = String(topic.title || "").match(/^(\d{2,})\s*-\s+/);
  return titleMatch ? Number(titleMatch[1]) : 0;
}

export function topicSort(a: Topic, b: Topic) {
  const dateDiff = dateRank(b.createdAt) - dateRank(a.createdAt);
  if (dateDiff) return dateDiff;
  const numberDiff = topicNumber(b) - topicNumber(a);
  if (numberDiff) return numberDiff;
  return a.title.localeCompare(b.title, "fr", { numeric: true });
}

function dateRank(value: string) {
  const time = Date.parse(`${value || ""}T00:00:00`);
  return Number.isNaN(time) ? 0 : time;
}

export function markdownToHtml(markdown: string) {
  let html = "";
  let ul = false;
  const close = () => {
    if (ul) {
      html += "</ul>";
      ul = false;
    }
  };
  String(markdown || "")
    .split("\n")
    .forEach((line) => {
      const value = line.trim();
      if (!value) {
        close();
        return;
      }
      if (value.startsWith("- ")) {
        if (!ul) {
          html += "<ul>";
          ul = true;
        }
        html += `<li>${inlineMarkdown(value.slice(2))}</li>`;
      } else {
        close();
        html += `<p>${inlineMarkdown(value)}</p>`;
      }
    });
  close();
  return html || "<p></p>";
}

function inlineMarkdown(value: string) {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export interface NoteEntry {
  date: string;
  text: string;
}

export function parseNoteEntries(topic: Topic): NoteEntry[] {
  const fallbackDate = topic.createdAt || todayIso();
  const raw = String(topic.notes || "").trim();
  if (!raw) return [];
  return raw
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const normalized = block.replace(/^\s*[-*]\s+/, "");
      const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+[—-]\s+([\s\S]+)$/);
      return match ? { date: match[1], text: match[2].trim() } : { date: fallbackDate, text: normalized };
    });
}

export function serializeNoteEntries(entries: NoteEntry[]) {
  return entries
    .map((entry) => ({ date: entry.date || todayIso(), text: text(entry.text) }))
    .filter((entry) => entry.text)
    .map((entry) => `- ${entry.date} — ${entry.text}`)
    .join("\n\n");
}

export function badgeText(status: TopicStatus) {
  return status === "resolved"
    ? "Traité"
    : status === "partial"
      ? "Partiellement traité"
      : status === "urgent"
        ? "Urgent"
        : "À Traiter";
}

export function documentYear(href: string, topic: Topic) {
  const nextHref = String(href || "").match(/^Documents\/Incidents\/(\d{4})\//);
  if (nextHref) return nextHref[1];
  const legacyHref = String(href || "").match(/^Documents\/(\d{4})\//);
  if (legacyHref) return legacyHref[1];
  const topicYear = String(topic.createdAt || "").match(/^(\d{4})-/);
  return topicYear ? topicYear[1] : String(new Date().getFullYear());
}
