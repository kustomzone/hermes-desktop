export type {
  Attachment,
  AttachmentKind,
} from "../../../../shared/attachments";

import type { Attachment } from "../../../../shared/attachments";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  attachments?: Attachment[];
}

export interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: {
    provider: string;
    model: string;
    label: string;
    baseUrl: string;
  }[];
}

export interface UsageState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}
