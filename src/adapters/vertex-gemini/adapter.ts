import { GoogleGenAI } from '@google/genai';
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
  appendGeminiAssistantToolCall,
  appendGeminiToolResult,
  listGeminiModels,
  streamFromGemini,
} from '../google/_streaming.js';
import { vertexGeminiManifest } from './manifest.js';

/**
 * Adapter for Gemini models running on Vertex AI.
 *
 * Wire shape is identical to the `google` adapter — both use `@google/genai`
 * and speak the same contents/parts protocol. The only differences are:
 *   - Client is constructed with `vertexai: true` plus project/location.
 *   - Auth uses a GCP service account (pass through `googleAuthOptions`).
 *
 * For third-party models hosted on Vertex (Mistral, Llama, etc.) that speak
 * the OpenAI-compatible protocol, see the `vertex-openai` adapter.
 */
export class VertexGeminiAdapter implements LlmAdapter<VertexServiceAccountAuth> {
  readonly vendor = vertexGeminiManifest.vendor;
  readonly acceptedAuth = ['vertexServiceAccount'] as const;

  private client: GoogleGenAI | undefined;

  init(auth: VertexServiceAccountAuth, _client?: ClientOptions): void {
    if (auth.kind !== 'vertexServiceAccount') {
      throw new Error(
        `VertexGeminiAdapter: unsupported auth kind '${(auth as { kind: string }).kind}'`,
      );
    }
    if (!auth.credentials) {
      throw new Error('VertexGeminiAdapter: service-account credentials are required');
    }
    if (!auth.projectId) {
      throw new Error('VertexGeminiAdapter: projectId is required');
    }
    if (!auth.location) {
      throw new Error('VertexGeminiAdapter: location is required');
    }

    this.client = new GoogleGenAI({
      vertexai: true,
      project: auth.projectId,
      location: auth.location,
      googleAuthOptions: {
        credentials: auth.credentials as Record<string, unknown>,
      },
    });
  }

  stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    return streamFromGemini(this.ensureClient(), req);
  }

  appendAssistantToolCall(
    history: Message[],
    toolCalls: ReadonlyArray<ToolCallEvent>,
  ): Message[] {
    return appendGeminiAssistantToolCall(history, toolCalls);
  }

  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[] {
    return appendGeminiToolResult(history, toolCallId, result);
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    return listGeminiModels(this.ensureClient(), vertexGeminiManifest.knownModels);
  }

  async warmup(): Promise<void> {
    // No cheap idempotent warmup endpoint. No-op.
  }

  private ensureClient(): GoogleGenAI {
    if (!this.client) {
      throw new Error(
        'VertexGeminiAdapter: init() must be called before stream()/listAvailableModels()',
      );
    }
    return this.client;
  }
}
