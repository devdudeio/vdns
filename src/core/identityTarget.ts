export type UpdateIdentityTarget = {
  targetIdentity: string;
  updateIdentityName: string;
  parent?: string;
  identityAddress?: string;
  friendlyName?: string;
  fullyQualifiedName?: string;
};

export function normalizeIdentityNameForUpdate(input: string): string {
  const identity = input.trim();
  if (!identity) {
    throw new Error("Identity name is required");
  }
  if (/\s/.test(identity) || identity.includes("/")) {
    throw new Error("Identity name must not contain whitespace or slashes");
  }
  return identity.endsWith("@") ? identity : `${identity}@`;
}

export function deriveUpdateIdentityTarget(targetIdentityInput: string, rawIdentity: unknown): UpdateIdentityTarget {
  const targetIdentity = normalizeIdentityNameForUpdate(targetIdentityInput);
  const rawIdentityObject = getRawIdentityObject(rawIdentity);
  const rawName = pickString(rawIdentityObject, "name");
  const updateIdentityName = rawName
    ? normalizeRawNameForPayload(rawName, targetIdentity)
    : deriveFallbackUpdateName(targetIdentity);
  const parent = pickString(rawIdentityObject, "parent");
  const identityAddress = pickString(rawIdentityObject, "identityaddress");
  const friendlyName = pickString(rawIdentityObject, "friendlyname");
  const fullyQualifiedName = pickString(rawIdentityObject, "fullyqualifiedname");

  return {
    targetIdentity,
    updateIdentityName,
    ...(parent ? { parent } : {}),
    ...(identityAddress ? { identityAddress } : {}),
    ...(friendlyName ? { friendlyName } : {}),
    ...(fullyQualifiedName ? { fullyQualifiedName } : {})
  };
}

export function deriveParentLookupIdentity(targetIdentityInput: string): string | undefined {
  const targetIdentity = normalizeIdentityNameForUpdate(targetIdentityInput);
  const withoutAt = targetIdentity.slice(0, -1);
  const dotIndex = withoutAt.indexOf(".");
  if (dotIndex === -1 || dotIndex === withoutAt.length - 1) {
    return undefined;
  }
  return normalizeIdentityNameForUpdate(withoutAt.slice(dotIndex + 1));
}

export function extractRawIdentityAddress(rawIdentity: unknown): string | undefined {
  return pickString(getRawIdentityObject(rawIdentity), "identityaddress");
}

function normalizeRawNameForPayload(rawName: string, targetIdentity: string): string {
  const name = rawName.trim();
  if (!name) {
    return deriveFallbackUpdateName(targetIdentity);
  }

  if (isSubidentity(targetIdentity) && !name.includes(".") && !name.endsWith("@")) {
    return name;
  }

  return normalizeIdentityNameForUpdate(name);
}

function deriveFallbackUpdateName(targetIdentity: string): string {
  const withoutAt = targetIdentity.endsWith("@") ? targetIdentity.slice(0, -1) : targetIdentity;
  const dotIndex = withoutAt.indexOf(".");
  if (dotIndex !== -1) {
    return withoutAt.slice(0, dotIndex);
  }
  return normalizeIdentityNameForUpdate(withoutAt);
}

function isSubidentity(identity: string): boolean {
  return identity.slice(0, -1).includes(".");
}

function getRawIdentityObject(input: unknown): Record<string, unknown> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  if (isRecord(input.result) && isRecord(input.result.identity)) {
    return input.result.identity;
  }

  if (isRecord(input.identity)) {
    return input.identity;
  }

  return input;
}

function pickString(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
