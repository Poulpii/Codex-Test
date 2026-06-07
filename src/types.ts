export type TopicStatus = "urgent" | "todo" | "partial" | "resolved";
export type ViewName = "incidents" | "directory" | "contract";
export type StatFilter = "active" | TopicStatus;

export interface TopicDocument {
  label: string;
  href: string;
  type: "image" | "file";
  description?: string;
}

export interface TopicAction {
  text: string;
  done: boolean;
}

export interface Topic {
  id: string;
  title: string;
  createdAt: string;
  filter: string;
  folder?: string;
  priority?: "urgent" | "";
  status: TopicStatus;
  sourceFile: string;
  body: string;
  notes: string;
  documents: TopicDocument[];
  actions: TopicAction[];
}

export interface AppConfig {
  propertyAddress: string;
  syndicName: string;
  filters: string[];
}

export interface TopicsPayload {
  topics: Topic[];
  filters: string[];
}

export interface DirectoryPayload {
  entries: DirectoryEntry[];
  options: DirectoryOptions;
}

export interface DirectoryEntry {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  lot: string;
  building: string;
  floor: string;
  occupancy: string;
  council: string;
}

export interface DirectoryOptions {
  building: string[];
  floor: string[];
  occupancy: string[];
  council: string[];
}
