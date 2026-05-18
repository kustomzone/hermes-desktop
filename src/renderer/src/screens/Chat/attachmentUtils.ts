import {
  type Attachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  isImageMime,
  isTextFile,
} from "../../../../shared/attachments";

export interface AttachmentError {
  code:
    | "too-many"
    | "image-too-large"
    | "text-too-large"
    | "unsupported-type"
    | "read-failed";
  filename: string;
  detail?: string;
}

function newId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsText(file, "utf-8");
  });
}

export interface ProcessFilesResult {
  attachments: Attachment[];
  errors: AttachmentError[];
}

/**
 * Convert browser File objects into Attachment values, applying size/type
 * limits.  Returns successful attachments and a list of per-file errors so
 * the caller can surface them without aborting the whole batch.
 */
export async function processFiles(
  files: File[] | FileList,
  existingCount: number,
): Promise<ProcessFilesResult> {
  const list = Array.from(files);
  const attachments: Attachment[] = [];
  const errors: AttachmentError[] = [];

  const slotsRemaining = Math.max(
    0,
    MAX_ATTACHMENTS_PER_MESSAGE - existingCount,
  );

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (i >= slotsRemaining) {
      errors.push({ code: "too-many", filename: file.name });
      continue;
    }

    const mime = file.type || "";
    const name = file.name || "untitled";

    if (isImageMime(mime)) {
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push({ code: "image-too-large", filename: name });
        continue;
      }
      try {
        const dataUrl = await readAsDataUrl(file);
        attachments.push({
          id: newId(),
          kind: "image",
          name,
          mime,
          size: file.size,
          dataUrl,
        });
      } catch (err) {
        errors.push({
          code: "read-failed",
          filename: name,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    if (isTextFile(mime, name)) {
      if (file.size > MAX_TEXT_BYTES) {
        errors.push({ code: "text-too-large", filename: name });
        continue;
      }
      try {
        const text = await readAsText(file);
        attachments.push({
          id: newId(),
          kind: "text-file",
          name,
          mime: mime || "text/plain",
          size: file.size,
          text,
        });
      } catch (err) {
        errors.push({
          code: "read-failed",
          filename: name,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    errors.push({ code: "unsupported-type", filename: name });
  }

  return { attachments, errors };
}

/**
 * Extract any File objects from a clipboard paste event.  Returns:
 * - {files: File[], hasText: boolean} where hasText indicates whether the
 *   clipboard also contained plain text (so callers can decide whether to
 *   suppress the default paste behavior).
 */
export function filesFromClipboard(event: ClipboardEvent | React.ClipboardEvent): {
  files: File[];
  hasText: boolean;
} {
  const files: File[] = [];
  let hasText = false;
  const items = event.clipboardData?.items;
  if (!items) return { files, hasText };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) files.push(f);
    } else if (it.kind === "string" && it.type === "text/plain") {
      hasText = true;
    }
  }
  return { files, hasText };
}
