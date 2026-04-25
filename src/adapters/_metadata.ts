/**
 * Shared helpers for vendor-metadata extractors.
 *
 * Each adapter that wants to surface response-header diagnostics (request
 * id, rate-limit remaining, routing/region, vendor processing time, cache
 * counts) declares an allowlist of `header-name` → `output-key` pairs
 * here. The extractor walks the allowlist, reads each header, parses
 * numeric values, and returns a flat record. Empty/absent headers are
 * dropped — never emit `null`.
 *
 * Output shape is `Record<string, string | number>` so consumers
 * (feature-server, webapp) can render it as a key/value table without
 * per-vendor knowledge.
 */

export interface MetadataField {
  /** Lowercase HTTP header name to read. */
  header: string;
  /** Key under which the value is exposed in `vendorMetadata`. */
  key: string;
  /** Parse numeric values to `number` instead of leaving as `string`. */
  numeric?: boolean;
}

/**
 * Build a `vendorMetadataExtractor` from a static field list. Adapters
 * import this and pass the result to `streamFromOpenAI` (or call directly
 * for native-SDK adapters).
 */
export function makeMetadataExtractor(
  fields: ReadonlyArray<MetadataField>,
): (headers: Headers) => Record<string, string | number> {
  return (headers: Headers) => {
    const out: Record<string, string | number> = {};
    for (const f of fields) {
      const raw = headers.get(f.header);
      if (raw === null || raw === undefined || raw === '') continue;
      if (f.numeric) {
        const n = Number(raw);
        if (Number.isFinite(n)) out[f.key] = n;
      } else {
        out[f.key] = raw;
      }
    }
    return out;
  };
}

/**
 * Convenience: run the extractor against a generic header source (a
 * `Headers` instance, a record, or AWS-SDK-style `httpHeaders`) by
 * normalizing first. Used by native-SDK adapters whose response shapes
 * don't expose a real `Headers` object.
 */
export function extractMetadata(
  fields: ReadonlyArray<MetadataField>,
  headers: Record<string, string | string[] | undefined> | Headers,
): Record<string, string | number> {
  const headersInstance =
    headers instanceof Headers ? headers : recordToHeaders(headers);
  return makeMetadataExtractor(fields)(headersInstance);
}

function recordToHeaders(
  record: Record<string, string | string[] | undefined>,
): Headers {
  const h = new Headers();
  for (const [name, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) h.append(name, v);
    } else {
      h.set(name, value);
    }
  }
  return h;
}
