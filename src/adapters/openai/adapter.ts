import OpenAI from 'openai';
import type {
  ApiKeyAuth,
  ClientOptions,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  ToolCallEvent,
} from '../../types.js';
import {
  appendOpenAIAssistantToolCall,
  appendOpenAIToolResult,
  listOpenAICompatibleModels,
  streamFromOpenAI,
} from './_streaming.js';
import { openAIManifest } from './manifest.js';

/**
 * Adapter for OpenAI (and OpenAI-compatible endpoints: DeepSeek, LM Studio,
 * Ollama, vLLM, custom gateways).
 *
 * Wire translation lives in `_streaming.ts` and is shared with the
 * Vertex-OpenAI adapter — both use the same `openai` SDK with the same
 * on-wire shape; only client construction (auth, baseURL, fetch wrapper)
 * differs.
 */
export class OpenAIAdapter implements LlmAdapter<ApiKeyAuth> {
  readonly vendor = openAIManifest.vendor;
  readonly acceptedAuth = ['apiKey'] as const;

  protected client: OpenAI | undefined;

  init(auth: ApiKeyAuth, client?: ClientOptions): void {
    if (!auth.apiKey) {
      throw new Error('OpenAIAdapter: apiKey is required');
    }
    this.client = new OpenAI({
      apiKey: auth.apiKey,
      ...(auth.baseURL ? { baseURL: auth.baseURL } : {}),
      ...(client?.timeout !== undefined ? { timeout: client.timeout } : {}),
      ...(client?.maxRetries !== undefined ? { maxRetries: client.maxRetries } : {}),
    });
  }

  stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    return streamFromOpenAI(this.ensureClient(), req, {
      knownModels: openAIManifest.knownModels,
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
    return listOpenAICompatibleModels(this.ensureClient(), openAIManifest.knownModels);
  }

  async warmup(): Promise<void> {
    const client = this.ensureClient();
    await client.models.list().catch(() => undefined);
  }

  protected ensureClient(): OpenAI {
    if (!this.client) {
      throw new Error('OpenAIAdapter: init() must be called before stream()/listAvailableModels()');
    }
    return this.client;
  }
}
