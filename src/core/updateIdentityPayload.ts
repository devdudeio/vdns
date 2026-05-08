export { normalizeIdentityNameForUpdate } from "./identityTarget.js";

export type UpdateIdentityPayload = {
  name: string;
  parent?: string;
  contentmultimap: Record<string, unknown>;
};

export function buildUpdateIdentityPayload(input: {
  updateIdentityName: string;
  parent?: string;
  contentmultimap: Record<string, unknown>;
}): UpdateIdentityPayload {
  const name = input.updateIdentityName.trim();
  if (!name) {
    throw new Error("Update identity name is required");
  }

  return {
    name,
    ...(input.parent ? { parent: input.parent } : {}),
    contentmultimap: input.contentmultimap
  };
}
