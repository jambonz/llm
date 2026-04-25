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

import { registerAdapter } from '../registry.js';
import { openAIFactory, deepseekFactory } from './openai/index.js';
import { anthropicFactory } from './anthropic/index.js';
import { googleFactory } from './google/index.js';
import { vertexGeminiFactory } from './vertex-gemini/index.js';
import { vertexOpenAIFactory } from './vertex-openai/index.js';
import { bedrockFactory } from './bedrock/index.js';
import { azureOpenAIFactory } from './azure-openai/index.js';
import { groqFactory } from './groq/index.js';

registerAdapter(openAIFactory);
registerAdapter(deepseekFactory);
registerAdapter(anthropicFactory);
registerAdapter(googleFactory);
registerAdapter(vertexGeminiFactory);
registerAdapter(vertexOpenAIFactory);
registerAdapter(bedrockFactory);
registerAdapter(azureOpenAIFactory);
registerAdapter(groqFactory);
