import OpenAI from 'openai';
import { GoogleAuth } from 'google-auth-library';
import type {
  ClientOptions,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  ToolCallEvent,
  VertexServiceAccountAuth,
} from '../../types.js';
import {
  appendOpenAIAssistantToolCall,
  appendOpenAIToolResult,
  streamFromOpenAI,
} from '../openai/_streaming.js';
import { vertexOpenAIManifest } from './manifest.js';

/**
 * Adapter for third-party models on Vertex AI (Mistral, Llama, etc.) that
 * expose an OpenAI-compatible endpoint. Shares all wire translation with
 * the native OpenAI adapter; only the client differs — `baseURL` is
 * Vertex-specific and a custom `fetch` wraps each request to inject a GCP
 * Bearer token from a service account.
 */
export class VertexOpenAIAdapter implements LlmAdapter<VertexServiceAccountAuth> {
  readonly vendor = vertexOpenAIManifest.vendor;
  readonly acceptedAuth = ['vertexServiceAccount'] as const;

  private client: OpenAI | undefined;
  private googleAuth: GoogleAuth | undefined;

  init(auth: VertexServiceAccountAuth, client?: ClientOptions): void {
    if (auth.kind !== 'vertexServiceAccount') {
      throw new Error(
        `VertexOpenAIAdapter: unsupported auth kind '${(auth as { kind: string }).kind}'`,
      );
    }
    if (!auth.credentials) {
      throw new Error('VertexOpenAIAdapter: service-account credentials are required');
    }
    if (!auth.projectId) {
      throw new Error('VertexOpenAIAdapter: projectId is required');
    }
    if (!auth.location) {
      throw new Error('VertexOpenAIAdapter: location is required');
    }

    // Vertex AI's OpenAI-compatible endpoint is at /v1beta1/ — documented in
    // Google's SDK examples (google-cloud-aiplatform) and Google Cloud docs.
    // A /v1/ variant returns 404; do not use.
    const baseURL =
      `https://${auth.location}-aiplatform.googleapis.com/v1beta1/projects/` +
      `${auth.projectId}/locations/${auth.location}/endpoints/openapi`;

    this.googleAuth = new GoogleAuth({
      credentials: auth.credentials as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const authedFetch: typeof fetch = async (input, init) => {
      const googleClient = await this.googleAuth!.getClient();
      const token = await googleClient.getAccessToken();
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token.token ?? ''}`);
      const response = await fetch(input, { ...init, headers });
      if (!response.ok) {
        return surfaceErrorBody(response, input);
      }
      return response;
    };

    this.client = new OpenAI({
      apiKey: 'vertex-ai',
      baseURL,
      fetch: authedFetch as never,
      ...(client?.timeout !== undefined ? { timeout: client.timeout } : {}),
      ...(client?.maxRetries !== undefined ? { maxRetries: client.maxRetries } : {}),
    });
  }

  stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    // Vertex AI's Llama MaaS endpoint returns an empty assistant message
    // (zero tokens, finish_reason: stop) when max_tokens is not set. Apply
    // a sensible default so callers don't have to know this quirk.
    return streamFromOpenAI(this.ensureClient(), req, {
      knownModels: vertexOpenAIManifest.knownModels,
      defaultMaxTokens: 4096,
    });
  }

  appendAssistantToolCall(
    history: Message[],
    toolCalls: ReadonlyArray<ToolCallEvent>,
  ): Message[] {
    return appendOpenAIAssistantToolCall(history, toolCalls);
  }

  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[] {
    return appendOpenAIToolResult(history, toolCallId, result);
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    // The Vertex OpenAI-compatible endpoint does not expose a models list.
    // Return the curated set from the manifest.
    return [...vertexOpenAIManifest.knownModels];
  }

  async testCredential(): Promise<void> {
    // The OpenAI-compat endpoint has no list-models or other zero-cost
    // authenticated endpoint. Chat probes against a specific model are a
    // bad proxy: they require that partner model (Mistral, Llama, …) to be
    // granted in the caller's GCP project, which is independent of whether
    // the service-account credentials themselves are valid.
    //
    // Minting a Google access token from the service-account is sufficient
    // and vendor-appropriate: it verifies the credential JSON is well-formed,
    // the service account exists, and the key is active. If the token mints
    // but the caller hasn't enabled Vertex AI or a specific partner model in
    // the project, the first stream() call will tell them — credential
    // validity and model entitlement are properly separated concerns.
    if (!this.googleAuth) {
      throw new Error('VertexOpenAIAdapter: init() must be called before testCredential()');
    }
    const googleClient = await this.googleAuth.getClient();
    const token = await googleClient.getAccessToken();
    if (!token.token) {
      throw new Error('VertexOpenAIAdapter: service account did not mint an access token');
    }
  }

  async warmup(): Promise<void> {
    // No cheap idempotent warmup endpoint. No-op.
  }

  private ensureClient(): OpenAI {
    if (!this.client) {
      throw new Error(
        'VertexOpenAIAdapter: init() must be called before stream()/listAvailableModels()',
      );
    }
    return this.client;
  }
}

/**
 * On a non-2xx response, read the Vertex error body and reconstruct the
 * Response so the OpenAI SDK can include the body in its thrown error.
 *
 * Why this is necessary: the OpenAI SDK v6 drops the body on some error
 * responses (the ones delivered gzipped, which Vertex does) — callers see
 * "404 status code (no body)" with no indication of root cause. Vertex's
 * real body for the model-in-wrong-region case carries useful text naming
 * the model and region. Reading the body here (before the SDK's parser gets
 * it) lets us pass it through as plain text; the SDK then surfaces it
 * verbatim in `err.message`.
 */
async function surfaceErrorBody(
  response: Response,
  input: Parameters<typeof fetch>[0],
): Promise<Response> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // Body already consumed or unreadable — fall through with empty body.
  }

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const hint =
    response.status === 404 && !body
      ? ' (no body returned — most commonly means the requested model is not hosted in this region; ' +
        'check Google\'s partner-model availability matrix)'
      : '';

  // Log so operators see the full vendor text in api-server / feature-server
  // logs regardless of how the thrown error is formatted downstream.
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      `[vertex-openai] ${response.status} ${response.statusText} from ${url}: ` +
        `${body || '(empty body)'}${hint}`,
    );
  }

  // Vertex wraps errors in a single-element JSON array: `[{error: {...}}]`.
  // The OpenAI SDK expects a bare object `{error: {...}}`, so when parsing
  // the array it fails to find `.error` and throws "no body". Unwrap the
  // array so the SDK's error.message carries the vendor's own text.
  const normalizedBody = unwrapVertexErrorArray(body) + hint;

  // Drop encoding headers so the SDK doesn't try to decompress plain text.
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');

  return new Response(normalizedBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function unwrapVertexErrorArray(body: string): string {
  if (!body) return body;
  const trimmed = body.trim();
  if (!trimmed.startsWith('[')) return body;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length === 1 && parsed[0]?.error) {
      return JSON.stringify(parsed[0]);
    }
  } catch {
    // not JSON; leave as-is
  }
  return body;
}
