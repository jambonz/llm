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
import { gptliveS2sManifest } from '../vendors/gptlive-s2s.js';
import { kugelaudioS2sManifest } from '../vendors/kugelaudio-s2s.js';
import { ultravoxS2sManifest } from '../vendors/ultravox-s2s.js';
import { deepgramS2sManifest } from '../vendors/deepgram-s2s.js';
import { elevenlabsS2sManifest } from '../vendors/elevenlabs-s2s.js';
import { googleS2sManifest } from '../vendors/google-s2s.js';
import { xaiS2sManifest } from '../vendors/xai-s2s.js';
import { qwenS2sManifest } from '../vendors/qwen-s2s.js';
import { assemblyaiS2sManifest } from '../vendors/assemblyai-s2s.js';
import { voiceliveS2sManifest } from '../vendors/voicelive-s2s.js';
import { azureOpenaiS2sManifest } from '../vendors/azure-openai-s2s.js';
import { novaS2sManifest } from '../vendors/nova-s2s.js';
import { phonicS2sManifest } from '../vendors/phonic-s2s.js';

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
registerCredentialVendor(gptliveS2sManifest);
registerCredentialVendor(kugelaudioS2sManifest);
registerCredentialVendor(ultravoxS2sManifest);
registerCredentialVendor(deepgramS2sManifest);
registerCredentialVendor(elevenlabsS2sManifest);
registerCredentialVendor(googleS2sManifest);
registerCredentialVendor(xaiS2sManifest);
registerCredentialVendor(qwenS2sManifest);
registerCredentialVendor(assemblyaiS2sManifest);
registerCredentialVendor(voiceliveS2sManifest);
registerCredentialVendor(azureOpenaiS2sManifest);
registerCredentialVendor(novaS2sManifest);
registerCredentialVendor(phonicS2sManifest);
registerCredentialVendor(dialogflowCesManifest);
