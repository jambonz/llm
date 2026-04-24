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
      return fetch(input, { ...init, headers });
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
