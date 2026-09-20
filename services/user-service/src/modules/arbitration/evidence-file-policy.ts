import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { basename } from "path";

export interface InspectedEvidenceFile {
  originalName: string;
  mediaType: SafeEvidenceMediaType;
  size: number;
  extension: string;
}

export type SafeEvidenceMediaType =
  | "image/jpeg"
  | "image/png"
  | "application/pdf"
  | "video/mp4";

const HARD_MAX_BYTES = 25 * 1024 * 1024;
const SIGNATURES: Record<
  SafeEvidenceMediaType,
  { extensions: string[]; matches: (buffer: Buffer) => boolean }
> = {
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  "image/png": {
    extensions: [".png"],
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  "application/pdf": {
    extensions: [".pdf"],
    matches: (buffer) =>
      buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-",
  },
  "video/mp4": {
    extensions: [".mp4"],
    matches: (buffer) =>
      buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp",
  },
};

/**
 * Inspect untrusted bytes before they enter quarantine. Caller-provided MIME,
 * extension and size must all agree with a small built-in safe-format list.
 * This is intentionally only the pre-scan gate; a malware scanner remains
 * mandatory before hashing, promotion or persistence.
 */
export function inspectEvidenceFile(input: {
  originalName: string;
  declaredMediaType: string;
  bytes: Buffer;
  configuredMaxBytes: number;
  configuredMediaTypes: string[];
}): InspectedEvidenceFile {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw new BadRequestException("Evidence file is empty");
  }
  if (
    !Number.isSafeInteger(input.configuredMaxBytes) ||
    input.configuredMaxBytes < 1
  ) {
    throw new BadRequestException("Evidence size policy is invalid");
  }

  const effectiveMax = Math.min(input.configuredMaxBytes, HARD_MAX_BYTES);
  if (input.bytes.length > effectiveMax) {
    throw new PayloadTooLargeException("Evidence file exceeds the size limit");
  }

  const mediaType = input.declaredMediaType
    .split(";", 1)[0]
    .trim()
    .toLowerCase() as SafeEvidenceMediaType;
  const signature = SIGNATURES[mediaType];
  const configured = new Set(
    input.configuredMediaTypes.map((value) => value.trim().toLowerCase()),
  );
  if (!signature || !configured.has(mediaType)) {
    throw new UnsupportedMediaTypeException("Evidence media type is not allowed");
  }
  if (!signature.matches(input.bytes)) {
    throw new UnsupportedMediaTypeException(
      "Evidence bytes do not match the declared media type",
    );
  }

  const originalName = sanitizeFileName(input.originalName);
  const extension = extensionOf(originalName);
  if (!signature.extensions.includes(extension)) {
    throw new UnsupportedMediaTypeException(
      "Evidence filename extension does not match its media type",
    );
  }

  return {
    originalName,
    mediaType,
    size: input.bytes.length,
    extension,
  };
}

function sanitizeFileName(value: string): string {
  const normalized = basename(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!normalized || normalized === "." || normalized.length > 128) {
    throw new BadRequestException("Evidence filename is invalid");
  }
  return normalized;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "" : fileName.slice(index).toLowerCase();
}
