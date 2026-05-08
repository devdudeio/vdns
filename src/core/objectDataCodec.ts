export type DecodeObjectDataResult = {
  value?: unknown;
  warnings: string[];
};

export function encodeJsonObjectData(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("hex");
}

export function decodeJsonObjectData(value: unknown): DecodeObjectDataResult {
  if (isRecord(value)) {
    return { value, warnings: [] };
  }

  if (value === null) {
    return { warnings: ["DataDescriptor objectdata is null and cannot be decoded"] };
  }

  if (typeof value !== "string") {
    return { warnings: [`DataDescriptor objectdata must be a hex JSON string, got ${typeof value}`] };
  }

  if (!isHex(value)) {
    return { warnings: ["DataDescriptor objectdata is not valid hex"] };
  }

  const json = Buffer.from(value, "hex").toString("utf8");
  try {
    return { value: JSON.parse(json), warnings: [] };
  } catch {
    return { warnings: ["DataDescriptor objectdata hex did not decode to valid JSON"] };
  }
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
