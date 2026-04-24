import type { RawCredential } from './normalize-auth.js';
import { getAdapterFactory } from './registry.js';
import type { AuthKindSchema } from './types.js';

/**
 * Given a vendor id and a raw snake_case credential blob, return the
 * `AuthKindSchema` from the vendor's manifest that matches the blob.
 *
 * Purpose: let credential-handling consumers (api-server's `encryptCredential`
 * in particular) validate and serialize the *right* set of fields for a
 * credential without carrying a per-vendor switch of their own. The
 * discriminator logic that distinguishes e.g. `bedrockApiKey` from
 * `bedrockIam` lives here, in the library, right next to `normalizeAuth`.
 *
 * Rules:
 *   - Vendor with a single `authKind`: that kind is returned unconditionally.
 *   - Bedrock: `access_key_id` + `secret_access_key` → `bedrockIam`; else `bedrockApiKey`.
 *   - Google: `service_key` present → `googleServiceAccount`; `api_key` present → `googleApiKey`.
 *
 * Throws if the vendor is unknown or if no declared authKind matches the blob.
 */
export interface RawCredentialLoose extends RawCredential {
  [key: string]: unknown;
}

export function pickAuthKind(vendor: string, raw: RawCredentialLoose): AuthKindSchema {
  const factory = getAdapterFactory(vendor);
  const { authKinds } = factory.manifest;

  if (authKinds.length === 1) {
    return authKinds[0]!;
  }

  switch (vendor) {
    case 'bedrock': {
      const iam = authKinds.find((k) => k.kind === 'bedrockIam');
      const apiKey = authKinds.find((k) => k.kind === 'bedrockApiKey');
      if (raw.access_key_id && raw.secret_access_key) {
        if (!iam) throw new Error(`pickAuthKind: bedrock manifest missing 'bedrockIam'`);
        return iam;
      }
      if (raw.api_key) {
        if (!apiKey) throw new Error(`pickAuthKind: bedrock manifest missing 'bedrockApiKey'`);
        return apiKey;
      }
      throw new Error(
        `pickAuthKind: bedrock credential missing both 'api_key' and ` +
          `('access_key_id' + 'secret_access_key')`,
      );
    }

    case 'google': {
      const svc = authKinds.find((k) => k.kind === 'googleServiceAccount');
      const apiKey = authKinds.find((k) => k.kind === 'googleApiKey');
      if (raw.service_key) {
        if (!svc) throw new Error(`pickAuthKind: google manifest missing 'googleServiceAccount'`);
        return svc;
      }
      if (raw.api_key) {
        if (!apiKey) throw new Error(`pickAuthKind: google manifest missing 'googleApiKey'`);
        return apiKey;
      }
      throw new Error(
        `pickAuthKind: google credential missing both 'api_key' and 'service_key'`,
      );
    }

    default:
      throw new Error(
        `pickAuthKind: vendor '${vendor}' declares ${authKinds.length} authKinds but ` +
          `has no discriminator rule. Add one in src/pick-auth-kind.ts.`,
      );
  }
}
