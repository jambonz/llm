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

    const googleAuth = new GoogleAuth({
      credentials: auth.credentials as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const authedFetch: typeof fetch = async (input, init) => {
      const googleClient = await googleAuth.getClient();
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
    return streamFromOpenAI(this.ensureClient(), req, {
      knownModels: vertexOpenAIManifest.knownModels,
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
