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
import { makeMetadataExtractor } from '../_metadata.js';
import { openAIManifest } from './manifest.js';

/**
 * OpenAI response-header diagnostics surfaced as `vendorMetadata` on the
 * `end` event. `request_id` is essential for support tickets;
 * `processing_ms` separates vendor inference time from network time;
 * the rate-limit headers help operators spot when an account is trending
 * toward exhaustion within a single call.
 */
const OPENAI_METADATA_EXTRACTOR = makeMetadataExtractor([
  { header: 'x-request-id', key: 'request_id' },
  { header: 'openai-processing-ms', key: 'processing_ms', numeric: true },
  { header: 'x-ratelimit-remaining-requests', key: 'requests_remaining', numeric: true },
  { header: 'x-ratelimit-remaining-tokens', key: 'tokens_remaining', numeric: true },
]);

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
      knownModels: this.knownModels(),
      vendorMetadataExtractor: OPENAI_METADATA_EXTRACTOR,
      includeCacheKey: this.forwardCacheKey(),
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
    return listOpenAICompatibleModels(this.ensureClient(), this.knownModels());
  }

  /**
   * Capability table used to enrich both `stream()` (for tools/vision gating)
   * and `listAvailableModels()` (for filling capability flags on live entries).
   * Subclasses backed by the same OpenAI wire (DeepSeek, Baseten, …) override
   * this so their own manifest entries are consulted instead of OpenAI's.
   */
  protected knownModels(): ReadonlyArray<ModelInfo> {
    return openAIManifest.knownModels;
  }

  /**
   * Whether to forward `req.cacheKey` as OpenAI's `prompt_cache_key` request
   * param. Default true — verified accepted by OpenAI, Azure OpenAI,
   * Vertex-OpenAI, and Baseten. OpenAI-compatible vendors whose param
   * handling is strict or unverified (DeepSeek, Moonshot, Zai, xAI — and
   * Groq via its own stream override) override to false: a strict backend
   * rejects the whole request on an unknown body param, which is far worse
   * than forgoing a cache-routing hint. Flip a vendor to true only after
   * verifying its endpoint (including any proxy in front of it, e.g.
   * Bedrock Mantle) tolerates the param.
   */
  protected forwardCacheKey(): boolean {
    return true;
  }

  async testCredential(): Promise<void> {
    // /v1/models is the cheapest authenticated GET on the OpenAI API.
    // Works for OpenAI proper and most compatible backends (DeepSeek included).
    await this.ensureClient().models.list();
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
