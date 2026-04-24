import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  BedrockApiKeyAuth,
  BedrockIamAuth,
  ClientOptions,
  FinishReason,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelInfo,
  PromptRequest,
  Tool,
} from '../../types.js';
import { assertValidRequest } from '../../validate.js';
import { bedrockManifest } from './manifest.js';

type BedrockAuthSpec = BedrockApiKeyAuth | BedrockIamAuth;

/**
 * Adapter for AWS Bedrock via the Converse API.
 *
 * Bedrock's Converse wire shape diverges from the other adapters:
 *   - Messages use `{role, content: [ContentBlock, ...]}` where content is
 *     ALWAYS an array. Text blocks are `{text}`; tool-use blocks are
 *     `{toolUse: {toolUseId, name, input}}`; tool results are
 *     `{toolResult: {toolUseId, content: [{text}]}}` carried on role `user`.
 *   - System prompt is `system: [{text}]` at the top level (array).
 *   - Tools go in `toolConfig: {tools: [{toolSpec: {name, description,
 *     inputSchema: {json}}}]}`.
 *   - Conversations must start with a `user` message; adjacent same-role
 *     messages are rejected by the service (the library does not validate —
 *     the caller is responsible for ordering).
 *   - Streaming events are different too:
 *       messageStart → (contentBlockStart → contentBlockDelta* →
 *                       contentBlockStop)* → messageStop → metadata
 *   - Auth has two modes: bedrockApiKey (bearer token) or bedrockIam
 *     (accessKeyId + secretAccessKey [+ sessionToken]).
 */
export class BedrockAdapter implements LlmAdapter<BedrockAuthSpec> {
  readonly vendor = bedrockManifest.vendor;
  readonly acceptedAuth = ['bedrockApiKey', 'bedrockIam'] as const;

  private client: BedrockRuntimeClient | undefined;

  init(auth: BedrockAuthSpec, client?: ClientOptions): void {
    if (!auth.region) {
      throw new Error('BedrockAdapter: region is required');
    }

    const config: Record<string, unknown> = {
      region: auth.region,
      ...(client?.endpoint ? { endpoint: client.endpoint } : {}),
      ...(client?.maxRetries !== undefined ? { maxAttempts: client.maxRetries + 1 } : {}),
    };

    if (auth.kind === 'bedrockApiKey') {
      if (!auth.apiKey) {
        throw new Error('BedrockAdapter: apiKey is required for bedrockApiKey auth');
      }
      // Bedrock API key is a bearer token — must be preferred over SigV4 so
      // it wins against ambient credentials (e.g., EC2 instance role).
      config.token = { token: auth.apiKey };
      config.authSchemePreference = ['httpBearerAuth'];
    } else if (auth.kind === 'bedrockIam') {
      if (!auth.accessKeyId || !auth.secretAccessKey) {
        throw new Error('BedrockAdapter: accessKeyId and secretAccessKey required for bedrockIam auth');
      }
      config.credentials = {
        accessKeyId: auth.accessKeyId,
        secretAccessKey: auth.secretAccessKey,
        ...(auth.sessionToken ? { sessionToken: auth.sessionToken } : {}),
      };
    } else {
      throw new Error(
        `BedrockAdapter: unsupported auth kind '${(auth as { kind: string }).kind}'`,
      );
    }

    this.client = new BedrockRuntimeClient(config);
  }

  async *stream(req: PromptRequest): AsyncIterable<LlmEvent> {
    assertValidRequest(req);
    const client = this.ensureClient();

    if (req.signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }

    const messages = buildWireMessages(req);
    const tools =
      req.tools && req.tools.length > 0 ? { tools: formatTools(req.tools) } : undefined;

    const inferenceConfig: Record<string, unknown> = {};
    if (req.maxTokens !== undefined) inferenceConfig.maxTokens = req.maxTokens;
    if (req.temperature !== undefined) inferenceConfig.temperature = req.temperature;

    const commandInput: Record<string, unknown> = {
      modelId: req.model,
      messages,
    };
    if (req.system) commandInput.system = [{ text: req.system }];
    if (tools) commandInput.toolConfig = tools;
    if (Object.keys(inferenceConfig).length > 0) {
      commandInput.inferenceConfig = inferenceConfig;
    }

    const command = new ConverseStreamCommand(
      commandInput as unknown as ConstructorParameters<typeof ConverseStreamCommand>[0],
    );

    let response;
    try {
      response = await client.send(command, { abortSignal: req.signal });
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }
      throw err;
    }

    if (!response.stream) {
      yield { type: 'end', finishReason: 'stop' };
      return;
    }

    let currentToolUse: PendingToolUse | null = null;
    const completedToolCalls: Array<{ id: string; name: string; arguments: unknown }> = [];
    let stopReason: string | undefined;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let totalTokens: number | undefined;

    try {
      for await (const event of response.stream as AsyncIterable<BedrockStreamEvent>) {
        if (req.signal?.aborted) {
          yield { type: 'end', finishReason: 'aborted' };
          return;
        }

        if (event.contentBlockStart) {
          const start = event.contentBlockStart.start;
          if (start?.toolUse) {
            currentToolUse = {
              id: start.toolUse.toolUseId ?? '',
              name: start.toolUse.name ?? '',
              inputText: '',
            };
            if (currentToolUse.id && currentToolUse.name) {
              yield {
                type: 'toolCallStart',
                id: currentToolUse.id,
                name: currentToolUse.name,
              };
            }
          }
        } else if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta.delta;
          if (delta?.text) {
            yield { type: 'token', text: delta.text };
          }
          if (delta?.toolUse && currentToolUse && typeof delta.toolUse.input === 'string') {
            currentToolUse.inputText += delta.toolUse.input;
          }
        } else if (event.contentBlockStop) {
          if (currentToolUse && currentToolUse.id && currentToolUse.name) {
            let parsed: unknown = {};
            try {
              parsed = currentToolUse.inputText ? JSON.parse(currentToolUse.inputText) : {};
            } catch {
              parsed = {};
            }
            completedToolCalls.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              arguments: parsed,
            });
          }
          currentToolUse = null;
        } else if (event.messageStop) {
          stopReason = event.messageStop.stopReason;
        } else if (event.metadata) {
          if (event.metadata.usage) {
            inputTokens = event.metadata.usage.inputTokens;
            outputTokens = event.metadata.usage.outputTokens;
            totalTokens = event.metadata.usage.totalTokens;
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        yield { type: 'end', finishReason: 'aborted' };
        return;
      }
      throw err;
    }

    if (req.signal?.aborted) {
      yield { type: 'end', finishReason: 'aborted' };
      return;
    }

    for (const tc of completedToolCalls) {
      yield {
        type: 'toolCall',
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      };
    }

    const finishReason = mapStopReason(stopReason, completedToolCalls.length > 0);
    const usage =
      inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined
        ? {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
            ...(totalTokens !== undefined ? { totalTokens } : {}),
          }
        : undefined;

    const endEvent: Extract<LlmEvent, { type: 'end' }> = {
      type: 'end',
      finishReason,
      ...(usage ? { usage } : {}),
      ...(stopReason ? { rawReason: stopReason } : {}),
    };
    yield endEvent;
  }

  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[] {
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    const wireMessage = {
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: toolCallId,
            content: [{ text }],
          },
        },
      ],
    };
    return [
      ...history,
      {
        role: 'tool',
        content: text,
        vendorRaw: wireMessage,
      },
    ];
  }

  async listAvailableModels(): Promise<ModelInfo[]> {
    // The bedrock-runtime client has no /models endpoint; the control-plane
    // @aws-sdk/client-bedrock package does but we don't pull it in. Return the
    // curated manifest set.
    return [...bedrockManifest.knownModels];
  }

  async warmup(): Promise<void> {
    // No cheap idempotent warmup. No-op.
  }

  private ensureClient(): BedrockRuntimeClient {
    if (!this.client) {
      throw new Error(
        'BedrockAdapter: init() must be called before stream()/listAvailableModels()',
      );
    }
    return this.client;
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PendingToolUse {
  id: string;
  name: string;
  inputText: string;
}

interface BedrockStreamEvent {
  messageStart?: { role?: string };
  contentBlockStart?: {
    start?: {
      toolUse?: { toolUseId?: string; name?: string };
    };
    contentBlockIndex?: number;
  };
  contentBlockDelta?: {
    delta?: {
      text?: string;
      toolUse?: { input?: string };
    };
    contentBlockIndex?: number;
  };
  contentBlockStop?: { contentBlockIndex?: number };
  messageStop?: { stopReason?: string };
  metadata?: {
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildWireMessages(req: PromptRequest): unknown[] {
  const out: unknown[] = [];
  for (const msg of req.messages) {
    if (msg.vendorRaw && typeof msg.vendorRaw === 'object') {
      out.push(msg.vendorRaw);
      continue;
    }
    // Normalize plain-string messages to Converse's content-block array shape.
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    // Bedrock Converse does not accept role:'tool' — tool results must be
    // carried as content blocks on a role:'user' message. Without vendorRaw
    // we fall back to a text block.
    const role = msg.role === 'tool' ? 'user' : msg.role;
    out.push({
      role,
      content: [{ text }],
    });
  }
  return out;
}

function formatTools(tools: Tool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    toolSpec: {
      name: t.name,
      // Bedrock rejects empty-string descriptions; fall back to a single space.
      description: t.description && t.description.length > 0 ? t.description : ' ',
      inputSchema: {
        json: t.parameters ?? { type: 'object', properties: {} },
      },
    },
  }));
}

function mapStopReason(r: string | undefined, hadToolCalls: boolean): FinishReason {
  if (hadToolCalls) return 'tool';
  switch (r) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool';
    case 'max_tokens':
      return 'length';
    case 'content_filtered':
    case 'guardrail_intervened':
      return 'filtered';
    default:
      return 'stop';
  }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e.name === 'AbortError' ||
    e.name === 'APIUserAbortError' ||
    e.code === 'ABORT_ERR' ||
    (typeof e.message === 'string' && /aborted/i.test(e.message))
  );
}
