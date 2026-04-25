import { AzureOpenAI } from 'openai';
import type {
  AzureOpenAIApiKeyAuth,
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
  streamFromOpenAI,
} from '../openai/_streaming.js';
import { makeMetadataExtractor } from '../_metadata.js';
import { azureOpenAIManifest } from './manifest.js';

/**
 * Azure OpenAI response-header diagnostics.
 *
 * `x-ms-region` confirms which datacenter served (operators sometimes
 * provision multi-region deployments and want to verify routing).
 * `x-ms-deployment-name` confirms the deployment that served — useful
 * because Azure deployment names are arbitrary user strings and a
 * misconfigured credential could be pointed at a different deployment
 * than expected. `apim-request-id` is for support tickets;
 * `azureml-model-session` is the underlying model session id.
 */
const AZURE_OPENAI_METADATA_EXTRACTOR = makeMetadataExtractor([
  { header: 'x-ms-region', key: 'region' },
  { header: 'x-ms-deployment-name', key: 'deployment' },
  { header: 'apim-request-id', key: 'request_id' },
  { header: 'azureml-model-session', key: 'model_session' },
  { header: 'x-ratelimit-remaining-requests', key: 'requests_remaining', numeric: true },
  { header: 'x-ratelimit-remaining-tokens', key: 'tokens_remaining', numeric: true },
]);

/**
 * Adapter for Azure OpenAI Service.
 *
 * Azure speaks an OpenAI-compatible wire protocol for chat completions, so the
 * adapter reuses `streamFromOpenAI` / `appendOpenAI*` from the OpenAI adapter.
 * What differs is client construction:
 *   - Auth is an `api-key` header, not `Authorization: Bearer`.
 *   - The URL embeds the *deployment* name, not the model id:
 *     `https://{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}`
 *   - The `model` field on the wire is ignored by Azure — the deployment in the
 *     URL determines which model runs.
 *
 * The `AzureOpenAI` class exported from the `openai` SDK handles all three
 * quirks for us. It extends `OpenAI`, so passing it to `streamFromOpenAI()`
 * works without translation.
 */
export class AzureOpenAIAdapter implements LlmAdapter<AzureOpenAIApiKeyAuth> {
  readonly vendor = azureOpenAIManifest.vendor;
  readonly acceptedAuth = ['azureOpenAIApiKey'] as const;

  private client: AzureOpenAI | undefined;

  init(auth: AzureOpenAIApiKeyAuth, client?: ClientOptions): void {
    if (auth.kind !== 'azureOpenAIApiKey') {
      throw new Error(
        `AzureOpenAIAdapter: unsupported auth kind '${(auth as { kind: string }).kind}'`,
      );
    }
    if (!auth.apiKey) {
      throw new Error('AzureOpenAIAdapter: apiKey is required');
    }
    if (!auth.endpoint) {
      throw new Error('AzureOpenAIAdapter: endpoint is required');
    }
    if (!auth.deployment) {
      throw new Error('AzureOpenAIAdapter: deployment is required');
    }
    if (!auth.apiVersion) {
      throw new Error('AzureOpenAIAdapter: apiVersion is required');
    }

    this.client = new AzureOpenAI({
      apiKey: auth.apiKey,
      endpoint: auth.endpoint,
      apiVersion: auth.apiVersion,
      deployment: auth.deployment,
      ...(client?.timeout !== undefined ? { timeout: client.timeout } : {}),
      ...(client?.maxRetries !== undefined ? { maxRetries: client.maxRetries } : {}),
    });
  }

  stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    // Azure deployment names are arbitrary user strings (e.g. `prod-gpt-4o`,
    // `my-assistant`, `gpt-5.4-mini`) — the model-id heuristic in
    // streamFromOpenAI can't see the underlying model, so pin the newer
    // parameter name. Microsoft's current Azure OpenAI backend accepts
    // `max_completion_tokens` for gpt-4o-family and requires it for
    // gpt-5-family / o-series reasoning models.
    return streamFromOpenAI(this.ensureClient(), req, {
      knownModels: azureOpenAIManifest.knownModels,
      tokensParam: 'max_completion_tokens',
      vendorMetadataExtractor: AZURE_OPENAI_METADATA_EXTRACTOR,
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
    // Azure's data-plane API doesn't expose a list-models endpoint; deployment
    // listing lives on the control plane (ARM) and requires AAD. Return the
    // manifest's curated set.
    return [...azureOpenAIManifest.knownModels];
  }

  async testCredential(): Promise<void> {
    // No cheap authenticated GET available on the data plane — `/models` on
    // Azure returns the account's deployments only if the key has the right
    // role, and is 404 on many configurations. A minimal chat-completions
    // call is the reliable probe: success proves the api-key authenticates
    // AND that the endpoint+deployment+api-version combination resolves.
    const client = this.ensureClient();
    await client.chat.completions.create({
      // Azure ignores `model` when a deployment is in the URL, but the SDK
      // still requires it as a parameter.
      model: 'probe',
      messages: [{ role: 'user', content: 'ping' }],
      // Use `max_completion_tokens` (not legacy `max_tokens`): gpt-5 family
      // and o-series reasoning models return 400 on the legacy parameter.
      // The newer name is a superset — also accepted by gpt-4o, gpt-4-turbo,
      // and gpt-3.5-turbo deployments — so it's the safe choice for a probe
      // that has to work regardless of the underlying deployment model.
      //
      // 256 (not 1): reasoning models consume reasoning tokens BEFORE
      // visible output, all counted against this cap. With 1 the model
      // can't produce any output and Azure returns
      // `400 Could not finish the message because max_tokens or model
      // output limit was reached`. 256 is comfortable headroom for
      // reasoning + a "pong"-sized reply on every model we ship in the
      // manifest, while still bounded so the probe can't run away on a
      // misconfigured deployment.
      max_completion_tokens: 256,
      stream: false,
    } as Parameters<typeof client.chat.completions.create>[0]);
  }

  async warmup(): Promise<void> {
    // No idempotent cheap endpoint on the data plane. No-op.
  }

  private ensureClient(): AzureOpenAI {
    if (!this.client) {
      throw new Error(
        'AzureOpenAIAdapter: init() must be called before stream()/listAvailableModels()',
      );
    }
    return this.client;
  }
}
