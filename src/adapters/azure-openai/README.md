# azure-openai

Adapter for **Azure OpenAI Service** — Microsoft's managed hosting of OpenAI models inside Azure. Not for `api.openai.com` (use [`openai`](../openai/) for that).

## Mental model

Azure OpenAI speaks the same wire protocol as OpenAI for chat completions, streaming, and tool calls. What differs is the transport:

- Auth header is `api-key: {key}` — **not** `Authorization: Bearer {key}`.
- URL is per-resource and embeds the *deployment* name, not the model id: `https://{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}`.
- The `model` field on the request is **ignored** — the deployment in the URL determines which model runs.
- `api-version` is a required query-string parameter that customers want to pin and rotate on their own schedule.

The `AzureOpenAI` class exported by the `openai` SDK handles all four quirks in its constructor, so this adapter is thin: it reuses [`../openai/_streaming.ts`](../openai/_streaming.ts) unchanged for chat wire translation.

## Auth

`azureOpenAIApiKey` only. The adapter takes four fields:

| field | example | notes |
| --- | --- | --- |
| `apiKey` | `abc123…` | Resource key from the Azure portal → OpenAI resource → Keys and Endpoint. |
| `endpoint` | `https://my-resource.openai.azure.com` | Resource endpoint, no trailing slash. |
| `deployment` | `prod-gpt-4o` | The name the user chose in Azure AI Studio — **not** the model id. |
| `apiVersion` | `2025-03-01-preview` | Data-plane api-version. Microsoft rolls these frequently; pin explicitly. gpt-5 / o-series deployments require `2025-03-01-preview` or later because Azure routes them through the Responses API under the hood. |

Microsoft Entra (AAD) / managed-identity auth is out of scope for v1. The `AzureOpenAI` SDK class supports it via `azureADTokenProvider`, so a future `kind: 'azureOpenAIAad'` can be added as an additional `authKind` without breaking changes.

## Deployment name vs model id — the gotcha

Customers frequently conflate the two. Azure allows arbitrary deployment names: you might have a deployment called `prod-chat` that runs `gpt-4o-mini`, and another called `gpt-4o` that runs `gpt-4-turbo`. The model id in the `PromptRequest.model` field is **ignored by Azure** — the deployment in the URL dictates what runs.

The adapter's `knownModels` list is keyed by underlying model (e.g. `gpt-4o`, `gpt-4o-mini`, `gpt-35-turbo`) so capability flags resolve correctly *when* the deployment name echoes the model id. Customers who use arbitrary deployment names will get a fallback `ModelCapabilities` — streaming+tools enabled, no vision flag. That's conservative but correct; real capability detection would require the caller to tell us which underlying model the deployment points at.

## `apiVersion` is a user field on purpose

Microsoft ships new `api-version` strings on a rolling monthly cadence. Customers who pin to an older version for reproducibility should not have to wait for a library release to move forward. The manifest ships `default: '2025-03-01-preview'` — the oldest version that works with gpt-5 / o-series deployments (Azure routes them through the Responses API which requires that api-version or later, even though we call `/chat/completions`). Users are free to override with a newer version if their deployment needs one.

## testCredential

No cheap list-endpoint on Azure's data plane — `/models` is 404 on many configurations, and control-plane `/deployments` needs AAD. The adapter's `testCredential()` issues a minimal `chat.completions.create` with `max_tokens: 1`:

- Resolves → api-key authenticates, endpoint resolves, deployment exists, api-version is accepted by the vendor.
- Throws → surfaces Azure's error (401 bad key, 404 bad deployment, etc.) so operators can diagnose.

This costs one token of generation per credential test. Acceptable — credential tests are operator-triggered, not hot-path.

## Quirks we've hit

None yet.

## Models

See [`manifest.ts`](./manifest.ts). Covers the common Azure-hosted OpenAI models. Fine-tune deployments (where the user trains a custom variant) and private-preview model ids are out of scope — capability detection falls back to defaults.

Add a new Azure-hosted model by appending to `knownModels`. No wire code changes needed unless the vendor introduces a new content-block shape or auth kind.
