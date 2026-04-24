import { GoogleGenAI } from '@google/genai';
import type {
  ClientOptions,
  GoogleApiKeyAuth,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  ToolCallEvent,
} from '../../types.js';
import {
  appendGeminiAssistantToolCall,
  appendGeminiToolResult,
  listGeminiModels,
  streamFromGemini,
} from './_streaming.js';
import { googleManifest } from './manifest.js';

/**
 * Adapter for Google Gemini via AI Studio (`@google/genai`, API key auth).
 *
 * Wire translation lives in `_streaming.ts` and is shared with the
 * Vertex-Gemini adapter — both use the same `@google/genai` SDK and the
 * same on-wire shape; only client construction differs.
 *
 * For service-account auth on Vertex AI, see the `vertex-gemini` adapter.
 */
export class GoogleAdapter implements LlmAdapter<GoogleApiKeyAuth> {
  readonly vendor = googleManifest.vendor;
  readonly acceptedAuth = ['googleApiKey'] as const;

  private client: GoogleGenAI | undefined;

  init(auth: GoogleApiKeyAuth, _client?: ClientOptions): void {
    if (auth.kind !== 'googleApiKey') {
      throw new Error(
        `GoogleAdapter: unsupported auth kind '${(auth as { kind: string }).kind}'`,
      );
    }
    if (!auth.apiKey) {
      throw new Error('GoogleAdapter: apiKey is required');
    }
    this.client = new GoogleGenAI({ apiKey: auth.apiKey });
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
    return listGeminiModels(this.ensureClient(), googleManifest.knownModels);
  }

  async testCredential(): Promise<void> {
    // Model listing authenticates; no stream needed.
    await listGeminiModels(this.ensureClient(), googleManifest.knownModels);
  }

  async warmup(): Promise<void> {
    // @google/genai has no cheap idempotent warmup endpoint. No-op.
  }

  private ensureClient(): GoogleGenAI {
    if (!this.client) {
      throw new Error('GoogleAdapter: init() must be called before stream()/listAvailableModels()');
    }
    return this.client;
  }
}
