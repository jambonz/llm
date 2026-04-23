/**
 * Public type surface for @jambonz/llm.
 *
 * These are the types that:
 *   - Callers (feature-server, etc.) use to make requests and consume events.
 *   - Vendor adapters implement.
 *   - api-server consumes to serve the /llm-vendors/manifest endpoint.
 *   - webapp consumes (via api-server) to render the add-LLM page.
 *
 * Contract guarantees are documented in docs/adding-a-vendor.md.
 */

// ---------------------------------------------------------------------------
// Messages & tools (wire-level request/response surface)
// ---------------------------------------------------------------------------

export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A single conversation turn. `role: 'system'` is not allowed in `PromptRequest.messages` —
 * pass system prompts via `PromptRequest.system` instead. Adapters still emit/accept
 * `role: 'system'` messages internally for some vendors, but that happens inside the adapter.
 *
 * `vendorRaw` is the escape hatch that preserves vendor-native message shapes
 * (Anthropic content blocks, OpenAI tool_calls arrays, Google parts, Bedrock content[]).
 * When an adapter emits an assistant message during streaming, it populates `vendorRaw`
 * with the vendor's native representation. On subsequent requests the same adapter reads
 * `vendorRaw` back as the source of truth, avoiding lossy normalization.
 */
export interface Message {
  role: Role;
  content: string | ContentBlock[];
  /** Opaque vendor-native wire shape. Callers should treat this as read-only. */
  vendorRaw?: unknown;
}

/**
 * Multi-part message content. Most turns use a plain string; blocks are used for
 * images, tool results (when the vendor requires a specific block shape that differs
 * from the OpenAI `role: 'tool'` convention), and other structured content.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { kind: 'url' | 'base64'; data: string; mimeType?: string } }
  | { type: 'toolResult'; toolCallId: string; content: string | unknown };

/**
 * Tool declaration in MCP-style flat shape. Adapters translate outwards per vendor
 * (e.g., OpenAI wraps in `{type: 'function', function: {...}}`).
 */
export interface Tool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: JsonSchema;
}

/** Minimal JSON Schema type — adapters and the library validate at the boundary. */
export type JsonSchema = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Request / event types
// ---------------------------------------------------------------------------

export interface PromptRequest {
  model: string;
  /**
   * System prompt. The library always passes this as a top-level parameter;
   * adapters place it per-vendor (top-level for Anthropic/Bedrock, config field
   * for Google, prepended as a message for OpenAI, etc.).
   */
  system?: string;
  /** Conversation turns. Must NOT contain `role: 'system'` — use `system` above. */
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  /** Abort the stream. Adapters MUST honor this and propagate to the vendor SDK. */
  signal?: AbortSignal;
}

export type LlmEvent =
  | { type: 'token'; text: string }
  | { type: 'toolCallStart'; id: string; name: string }
  | { type: 'toolCall'; id: string; name: string; arguments: unknown }
  | { type: 'end'; finishReason: FinishReason; usage?: Usage; rawReason?: string };

export type FinishReason =
  | 'stop'
  | 'tool'
  | 'length'
  | 'filtered'
  | 'error'
  | 'aborted';

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

// ---------------------------------------------------------------------------
// Auth (discriminated union — each adapter declares which kinds it accepts)
// ---------------------------------------------------------------------------

export type AuthSpec =
  | ApiKeyAuth
  | BedrockIamAuth
  | BedrockApiKeyAuth
  | GoogleApiKeyAuth
  | GoogleServiceAccountAuth
  | VertexServiceAccountAuth;

export interface ApiKeyAuth {
  kind: 'apiKey';
  apiKey: string;
  baseURL?: string;
}

export interface BedrockIamAuth {
  kind: 'bedrockIam';
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

export interface BedrockApiKeyAuth {
  kind: 'bedrockApiKey';
  apiKey: string;
  region: string;
}

export interface GoogleApiKeyAuth {
  kind: 'googleApiKey';
  apiKey: string;
}

export interface GoogleServiceAccountAuth {
  kind: 'googleServiceAccount';
  /** Parsed JSON of the service account key file. */
  credentials: ServiceAccountJson;
}

export interface VertexServiceAccountAuth {
  kind: 'vertexServiceAccount';
  credentials: ServiceAccountJson;
  projectId: string;
  location: string;
}

/**
 * Minimal shape of a Google service-account JSON. Kept loose intentionally —
 * validation happens inside the Google Auth library, not here.
 */
export interface ServiceAccountJson {
  type: string;
  project_id?: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  client_id?: string;
  [key: string]: unknown;
}

export type AuthKind = AuthSpec['kind'];

// ---------------------------------------------------------------------------
// Client options (transport knobs)
// ---------------------------------------------------------------------------

export interface ClientOptions {
  timeout?: number;
  maxRetries?: number;
  /** Custom endpoint, e.g. Bedrock VPC endpoint. Adapter-specific meaning. */
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// Models & capabilities
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  displayName?: string;
  capabilities: ModelCapabilities;
  deprecated?: boolean;
}

export interface ModelCapabilities {
  /** Whether the model supports streaming responses. */
  streaming: boolean;
  /** Whether the model supports function/tool calling. NOT a vendor-wide flag. */
  tools: boolean;
  /** Whether the model accepts image inputs. */
  vision: boolean;
  /** Whether the model accepts a system prompt (a few Gemini models do not). */
  systemPrompt: boolean;
  /** Maximum input context in tokens, if known. */
  maxContextTokens?: number;
}

// ---------------------------------------------------------------------------
// Manifest (form schema + display metadata for a vendor)
// ---------------------------------------------------------------------------

export interface AdapterManifest {
  /** Machine-readable vendor id (matches the `vendor` field in createLlm args). */
  vendor: string;
  /** Human-readable vendor name shown in the admin UI. */
  displayName: string;
  /** One or more accepted auth shapes. Webapp renders a toggle when length > 1. */
  authKinds: AuthKindSchema[];
  /** Curated list of known models for this vendor. Safe to ship in the manifest. */
  knownModels: ModelInfo[];
  /** Whether listAvailableModels() hits a live vendor endpoint. */
  supportsModelListing: boolean;
  /** Optional documentation link for this vendor. */
  docsUrl?: string;
}

export interface AuthKindSchema {
  kind: AuthKind;
  displayName: string;
  fields: FormField[];
}

export type FormFieldType =
  | 'text'
  | 'password'
  | 'url'
  | 'json-file'
  | 'select';

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  default?: string;
  /** Options for `type: 'select'`. Ignored for other types. */
  options?: { value: string; label: string }[];
  /** Hint text shown below the input. */
  help?: string;
}

// ---------------------------------------------------------------------------
// The adapter contract
// ---------------------------------------------------------------------------

/**
 * The interface every vendor adapter implements.
 *
 * An adapter is a class (or class-like object) that:
 *   1. Declares which auth kinds it accepts (`acceptedAuth`).
 *   2. Initializes a client from an `AuthSpec` (`init`).
 *   3. Streams a prompt as an AsyncIterable of `LlmEvent`s (`stream`).
 *   4. Appends a tool result to history in the vendor's native shape (`appendToolResult`).
 *   5. Lists models accessible to the credential (`listAvailableModels`).
 *
 * The `manifest` is exported as a module-level constant alongside the adapter.
 * See src/adapters/_template/ for a working skeleton.
 */
export interface LlmAdapter<A extends AuthSpec = AuthSpec> {
  /** Machine-readable vendor id. Must match `manifest.vendor`. */
  readonly vendor: string;
  /** The auth kinds this adapter accepts. Used by validators. */
  readonly acceptedAuth: ReadonlyArray<A['kind']>;

  /** One-time initialization with credentials. Called once per `createLlm` call. */
  init(auth: A, client?: ClientOptions): Promise<void> | void;

  /**
   * Stream a prompt. Yields an AsyncIterable of events:
   *   - `token` (zero or more)
   *   - `toolCallStart` (optional, zero or more)
   *   - `toolCall` (zero or more, fully accumulated)
   *   - `end` (exactly one, and last)
   *
   * MUST honor `req.signal` if provided — if aborted, emit `{type: 'end', finishReason: 'aborted'}`
   * and do not emit any pending `toolCall` events.
   */
  stream(req: PromptRequest): AsyncIterable<LlmEvent>;

  /**
   * Append a tool-result message to history in the vendor's native shape.
   * The returned array MUST be a valid `messages` input for a subsequent `stream()` call
   * on the same adapter.
   */
  appendToolResult(history: Message[], toolCallId: string, result: unknown): Message[];

  /**
   * Hit the vendor's list-models endpoint and return accessible models.
   * Requires init() to have been called.
   *
   * If the vendor does not support live listing, adapters may return the static
   * `knownModels` from the manifest — but `manifest.supportsModelListing` MUST be `false`
   * in that case.
   */
  listAvailableModels(): Promise<ModelInfo[]>;

  /**
   * Optional: pre-establish connection to the vendor API. Useful for reducing
   * cold-start latency on the first prompt. No-op if not implemented.
   */
  warmup?(): Promise<void>;
}

/**
 * The constructor/factory shape for an adapter. Registered at module load via
 * `registerAdapter`. The library calls this once per `createLlm` call.
 */
export interface AdapterFactory<A extends AuthSpec = AuthSpec> {
  /** Machine-readable vendor id. */
  readonly vendor: string;
  /** Static manifest describing this vendor. */
  readonly manifest: AdapterManifest;
  /** Construct a fresh adapter instance. */
  create(): LlmAdapter<A>;
}

// ---------------------------------------------------------------------------
// createLlm args
// ---------------------------------------------------------------------------

export interface CreateLlmArgs<A extends AuthSpec = AuthSpec> {
  /** Vendor id. Must match a registered adapter. */
  vendor: string;
  /** Credentials in the shape the adapter declares it accepts. */
  auth: A;
  /** Optional transport knobs. */
  client?: ClientOptions;
}
