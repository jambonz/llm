/**
 * @jambonz/llm — voice-oriented LLM adapter library.
 *
 * Public entry point. Importing this module auto-registers all bundled adapters
 * via the side-effectful import of `./adapters/index.js`.
 *
 * Consumers use:
 *   - `createLlm({vendor, auth, client?})` to get a ready-to-stream adapter instance.
 *   - `getManifest()` to enumerate registered vendors (used by api-server).
 *   - `normalizeAuth(vendor, rawCred)` to convert DB-shape creds to AuthSpec.
 *   - `registerAdapter(factory)` to add a custom adapter at runtime.
 */

// Side effect: register all bundled adapters. Must come first.
import './adapters/index.js';

import { getAdapterFactory } from './registry.js';
import type {
  AuthSpec,
  CreateLlmArgs,
  LlmAdapter,
} from './types.js';

export async function createLlm<A extends AuthSpec = AuthSpec>(
  args: CreateLlmArgs<A>,
): Promise<LlmAdapter<A>> {
  const factory = getAdapterFactory<A>(args.vendor);
  if (!factory.manifest.authKinds.some((k) => k.kind === args.auth.kind)) {
    const accepted = factory.manifest.authKinds.map((k) => k.kind).join(', ');
    throw new Error(
      `Vendor '${args.vendor}' does not accept auth kind '${args.auth.kind}'. ` +
        `Accepted kinds: ${accepted}`,
    );
  }
  const instance = factory.create();
  await Promise.resolve(instance.init(args.auth, args.client));
  return instance;
}

// Re-export the full public surface.
export type {
  AdapterFactory,
  AdapterManifest,
  ApiKeyAuth,
  AuthKind,
  AuthKindSchema,
  AuthSpec,
  BedrockApiKeyAuth,
  BedrockIamAuth,
  ClientOptions,
  ContentBlock,
  CreateLlmArgs,
  FinishReason,
  FormField,
  FormFieldType,
  GoogleApiKeyAuth,
  GoogleServiceAccountAuth,
  JsonSchema,
  LlmAdapter,
  LlmEvent,
  Message,
  ModelCapabilities,
  ModelInfo,
  PromptRequest,
  Role,
  ServiceAccountJson,
  Tool,
  ToolCallEvent,
  Usage,
  VertexServiceAccountAuth,
} from './types.js';

export { normalizeAuth } from './normalize-auth.js';
export type { RawCredential } from './normalize-auth.js';

export { assertValidRequest } from './validate.js';

export {
  getAdapterFactory,
  getManifest,
  listVendors,
  registerAdapter,
  replaceAdapter,
  unregisterAdapter,
} from './registry.js';
