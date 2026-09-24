import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { inspectEvidenceFile } from "./evidence-file-policy";

const PNG = Buffer.from("89504e470d0a1a0a00000000", "hex");

function inspect(overrides: Record<string, unknown> = {}) {
  return inspectEvidenceFile({
    originalName: "proof.png",
    declaredMediaType: "image/png",
    bytes: PNG,
    configuredMaxBytes: 1024,
    configuredMediaTypes: ["image/png", "application/pdf"],
    ...overrides,
  } as any);
}

describe("inspectEvidenceFile", () => {
  it("accepts bytes only when MIME, signature and extension agree", () => {
    expect(inspect()).toEqual({
      originalName: "proof.png",
      mediaType: "image/png",
      size: PNG.length,
      extension: ".png",
    });
  });

  it("strips path components instead of trusting the uploaded filename", () => {
    expect(inspect({ originalName: "../../proof.png" }).originalName).toBe(
      "proof.png",
    );
  });

  it("rejects empty and oversized evidence", () => {
    expect(() => inspect({ bytes: Buffer.alloc(0) })).toThrow(
      BadRequestException,
    );
    expect(() => inspect({ configuredMaxBytes: PNG.length - 1 })).toThrow(
      PayloadTooLargeException,
    );
  });

  it("rejects caller MIME spoofing and extension mismatch", () => {
    expect(() => inspect({ declaredMediaType: "application/pdf" })).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => inspect({ originalName: "proof.pdf" })).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it("rejects configured wildcard, text and unknown formats", () => {
    expect(() =>
      inspect({
        configuredMediaTypes: ["image/*"],
      }),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      inspect({
        originalName: "proof.txt",
        declaredMediaType: "text/plain",
        bytes: Buffer.from("hello"),
        configuredMediaTypes: ["text/plain"],
      }),
    ).toThrow(UnsupportedMediaTypeException);
  });
});
