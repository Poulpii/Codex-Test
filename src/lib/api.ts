import { currentAccessToken } from "./accessToken";
import type { AppConfig, DirectoryPayload, Topic, TopicsPayload } from "../types";

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  const token = currentAccessToken();
  if (token) headers.set("X-Copropro-Token", token);
  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(payload?.error || `Erreur ${response.status}`);
  }
  return payload as T;
}

export const api = {
  config: () => request<AppConfig>("/api/config"),
  updateConfig: (config: AppConfig) =>
    request<AppConfig>("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    }),
  topics: () => request<TopicsPayload>("/api/topics"),
  directory: () => request<DirectoryPayload>("/api/directory"),
  updateDirectory: (directory: DirectoryPayload) =>
    request<DirectoryPayload>("/api/directory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(directory)
    }),
  createTopic: (topic: Partial<Topic>) =>
    request<{ topic: Topic; filters: string[] }>("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(topic)
    }),
  updateTopic: (topic: Topic) =>
    request<{ topic: Topic; filters: string[] }>(`/api/topics/${encodeURIComponent(topic.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(topic)
    }),
  deleteTopic: (topicId: string) =>
    request<{ ok: true; filters: string[] }>(`/api/topics/${encodeURIComponent(topicId)}`, { method: "DELETE" }),
  addAttachments: (topicId: string, formData: FormData) =>
    request<{ topic: Topic; filters: string[] }>(`/api/topics/${encodeURIComponent(topicId)}/attachments`, {
      method: "POST",
      body: formData
    }),
  removeAttachment: (topicId: string, index: number) =>
    request<{ topic: Topic; filters: string[] }>(`/api/topics/${encodeURIComponent(topicId)}/documents/${index}`, {
      method: "DELETE"
    }),
  createFilter: (name: string) =>
    request<{ filters: string[] }>("/api/filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    }),
  renameFilter: (oldName: string, name: string) =>
    request<TopicsPayload>(`/api/filters/${encodeURIComponent(oldName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    }),
  deleteFilter: (name: string) =>
    request<{ filters: string[] }>(`/api/filters/${encodeURIComponent(name)}`, { method: "DELETE" })
};
