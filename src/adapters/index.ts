/**
 * Central adapter registration.
 *
 * Each bundled vendor adapter is registered here at import time. When a new
 * vendor adapter is added under `src/adapters/<vendor>/`, add a single line
 * below to register its factory.
 *
 * The `_template` directory is intentionally NOT registered — it's a scaffold
 * for contributors to copy, not a live adapter.
 */

import { registerAdapter, registerCredentialVendor } from '../registry.js';
import {
  openAIFactory,
  deepseekFactory,
  basetenFactory,
  moonshotFactory,
  zaiFactory,
  xaiFactory,
  bedrockMantleFactory,
} from './openai/index.js';
import { anthropicFactory } from './anthropic/index.js';
import { googleFactory } from './google/index.js';
import { vertexGeminiFactory } from './vertex-gemini/index.js';
import { vertexOpenAIFactory } from './vertex-openai/index.js';
import { bedrockFactory } from './bedrock/index.js';
import { azureOpenAIFactory } from './azure-openai/index.js';
import { groqFactory } from './groq/index.js';
import { huggingfaceFactory } from './huggingface/index.js';
import { openRouterFactory } from './openrouter/index.js';
import { harnessManifest } from '../vendors/harness.js';
import { dialogflowCesManifest } from '../vendors/dialogflow-ces.js';
import { openaiS2sManifest } from '../vendors/openai-s2s.js';
import { rimeS2sManifest } from '../vendors/rime-s2s.js';

registerAdapter(openAIFactory);
registerAdapter(deepseekFactory);
registerAdapter(basetenFactory);
registerAdapter(moonshotFactory);
registerAdapter(zaiFactory);
registerAdapter(xaiFactory);
registerAdapter(bedrockMantleFactory);
registerAdapter(anthropicFactory);
registerAdapter(googleFactory);
registerAdapter(vertexGeminiFactory);
registerAdapter(vertexOpenAIFactory);
registerAdapter(bedrockFactory);
registerAdapter(azureOpenAIFactory);
registerAdapter(groqFactory);
registerAdapter(huggingfaceFactory);
registerAdapter(openRouterFactory);

// Credential-only vendors: a manifest for credential storage and the portal
// form, no adapter (see src/vendors/).
registerCredentialVendor(harnessManifest);
registerCredentialVendor(openaiS2sManifest);
registerCredentialVendor(rimeS2sManifest);
registerCredentialVendor(dialogflowCesManifest);
