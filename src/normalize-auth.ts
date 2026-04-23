import type {
  AuthSpec,
  BedrockApiKeyAuth,
  BedrockIamAuth,
  GoogleApiKeyAuth,
  GoogleServiceAccountAuth,
  ServiceAccountJson,
  VertexServiceAccountAuth,
} from './types.js';

/**
 * The loose "DB-shape" input accepted by `normalizeAuth`.
 *
 * This is the shape produced by jambonz's api-server after decryption, and by
 * feature-server's `credential-mapper.js`. Snake-case is used to match the
 * legacy wire shape; the helper converts to the `AuthSpec` discriminated union.
 *
 * External callers that construct `AuthSpec` directly can skip this helper entirely.
 */
export interface RawCredential {
  api_key?: string | null;
  /** Either a JSON string or a parsed object. */
  service_key?: string | ServiceAccountJson | null;
  access_key_id?: string | null;
  secret_access_key?: string | null;
  session_token?: string | null;
  region?: string | null;
  api_url?: string | null;
  project_id?: string | null;
  location?: string | null;
}

/**
 * Convert a vendor + raw credential into an `AuthSpec` discriminated union member.
 *
 * Supported vendors: openai, deepseek, anthropic, google, vertex (alias for
 * vertex-gemini + vertex-openai — both accept the same auth shape), vertex-gemini,
 * vertex-openai, bedrock.
 *
 * Throws with a clear message if the raw credential is missing required fields.
 */
export function normalizeAuth(vendor: string, raw: RawCredential): AuthSpec {
  switch (vendor) {
    case 'openai':
    case 'anthropic':
      return requireApiKey(vendor, raw);

    case 'deepseek':
      return {
        ...requireApiKey(vendor, raw),
        baseURL: raw.api_url ?? 'https://api.deepseek.com/v1',
      };

    case 'google':
      return normalizeGoogle(raw);

    case 'vertex':
    case 'vertex-gemini':
    case 'vertex-openai':
      return normalizeVertex(vendor, raw);

    case 'bedrock':
      return normalizeBedrock(raw);

    default:
      throw new Error(
        `normalizeAuth: unknown vendor '${vendor}'. ` +
          `If this is a custom adapter, construct the AuthSpec directly.`,
      );
  }
}

function requireApiKey(vendor: string, raw: RawCredential) {
  if (!raw.api_key) {
    throw new Error(`normalizeAuth: vendor '${vendor}' requires 'api_key'`);
  }
  const result: { kind: 'apiKey'; apiKey: string; baseURL?: string } = {
    kind: 'apiKey',
    apiKey: raw.api_key,
  };
  if (raw.api_url) {
    result.baseURL = raw.api_url;
  }
  return result;
}

function normalizeGoogle(raw: RawCredential): GoogleApiKeyAuth | GoogleServiceAccountAuth {
  if (raw.service_key) {
    return {
      kind: 'googleServiceAccount',
      credentials: parseServiceKey(raw.service_key),
    };
  }
  if (raw.api_key) {
    return { kind: 'googleApiKey', apiKey: raw.api_key };
  }
  throw new Error(`normalizeAuth: vendor 'google' requires either 'api_key' or 'service_key'`);
}

function normalizeVertex(vendor: string, raw: RawCredential): VertexServiceAccountAuth {
  if (!raw.service_key) {
    throw new Error(`normalizeAuth: vendor '${vendor}' requires 'service_key'`);
  }
  if (!raw.location) {
    throw new Error(`normalizeAuth: vendor '${vendor}' requires 'location'`);
  }
  const credentials = parseServiceKey(raw.service_key);
  const projectId = raw.project_id ?? credentials.project_id;
  if (!projectId) {
    throw new Error(
      `normalizeAuth: vendor '${vendor}' requires 'project_id' (not present ` +
        `in raw credential or service_key.project_id)`,
    );
  }
  return {
    kind: 'vertexServiceAccount',
    credentials,
    projectId,
    location: raw.location,
  };
}

function normalizeBedrock(raw: RawCredential): BedrockIamAuth | BedrockApiKeyAuth {
  if (!raw.region) {
    throw new Error(`normalizeAuth: vendor 'bedrock' requires 'region'`);
  }
  if (raw.access_key_id && raw.secret_access_key) {
    const result: BedrockIamAuth = {
      kind: 'bedrockIam',
      accessKeyId: raw.access_key_id,
      secretAccessKey: raw.secret_access_key,
      region: raw.region,
    };
    if (raw.session_token) {
      result.sessionToken = raw.session_token;
    }
    return result;
  }
  if (raw.api_key) {
    return {
      kind: 'bedrockApiKey',
      apiKey: raw.api_key,
      region: raw.region,
    };
  }
  throw new Error(
    `normalizeAuth: vendor 'bedrock' requires either (access_key_id + secret_access_key) or api_key`,
  );
}

function parseServiceKey(value: string | ServiceAccountJson): ServiceAccountJson {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as ServiceAccountJson;
    } catch {
      throw new Error(`normalizeAuth: 'service_key' is not valid JSON`);
    }
  }
  return value;
}
