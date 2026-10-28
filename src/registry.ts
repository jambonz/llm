import type { AdapterFactory, AdapterManifest, AuthSpec } from './types.js';

/**
 * Module-scope registry of adapter factories, keyed by vendor id.
 *
 * Adapters register themselves at import time via `registerAdapter`. Consumers
 * of the library then call `createLlm({vendor, auth})` and the factory for
 * that vendor is looked up here.
 */
const registry = new Map<string, AdapterFactory>();

/**
 * Vendors jambonz stores a credential for that have no adapter here
 * (`manifest.credentialOnly`). They appear in `getManifest()` and
 * `getVendorManifest()`, never in `getAdapterFactory()`.
 */
const credentialVendors = new Map<string, AdapterManifest>();

/**
 * Register an adapter factory. Called once per adapter at module load.
 *
 * Throws if a factory is already registered for the same vendor id — this
 * catches accidental double-registration and typos in `src/adapters/index.ts`.
 *
 * Use `replaceAdapter` if you deliberately need to override a registered adapter
 * (primarily useful in tests).
 */
export function registerAdapter(factory: AdapterFactory): void {
  if (registry.has(factory.vendor) || credentialVendors.has(factory.vendor)) {
    throw new Error(
      `Adapter already registered for vendor '${factory.vendor}'. ` +
        `Use replaceAdapter() if you intended to override.`,
    );
  }
  if (factory.vendor !== factory.manifest.vendor) {
    throw new Error(
      `Adapter factory vendor '${factory.vendor}' does not match ` +
        `manifest.vendor '${factory.manifest.vendor}'.`,
    );
  }
  registry.set(factory.vendor, factory);
}

/**
 * Register a credential-only vendor: a manifest with no adapter. Throws if
 * the id is already taken or the manifest is not marked `credentialOnly`.
 */
export function registerCredentialVendor(manifest: AdapterManifest): void {
  if (!manifest.credentialOnly) {
    throw new Error(`Vendor '${manifest.vendor}' manifest is not marked credentialOnly.`);
  }
  if (registry.has(manifest.vendor) || credentialVendors.has(manifest.vendor)) {
    throw new Error(`Vendor '${manifest.vendor}' is already registered.`);
  }
  credentialVendors.set(manifest.vendor, manifest);
}

/**
 * Replace an already-registered adapter. Intended for test overrides.
 */
export function replaceAdapter(factory: AdapterFactory): void {
  registry.set(factory.vendor, factory);
}

/**
 * Remove an adapter from the registry. Intended for test cleanup.
 */
export function unregisterAdapter(vendor: string): void {
  registry.delete(vendor);
}

/**
 * Get a registered adapter factory. Throws if unknown vendor.
 */
export function getAdapterFactory<A extends AuthSpec = AuthSpec>(
  vendor: string,
): AdapterFactory<A> {
  const factory = registry.get(vendor);
  if (!factory) {
    if (credentialVendors.has(vendor)) {
      throw new Error(
        `Vendor '${vendor}' is credential-only: @jambonz/llm has no adapter for it.`,
      );
    }
    const known = Array.from(registry.keys()).sort().join(', ') || '(none)';
    throw new Error(
      `Unknown vendor '${vendor}'. Registered vendors: ${known}`,
    );
  }
  return factory as AdapterFactory<A>;
}

/**
 * Get the manifest for any registered vendor, adapter-backed or
 * credential-only. Throws if unknown vendor. Use this (not
 * `getAdapterFactory`) where only the credential shape matters.
 */
export function getVendorManifest(vendor: string): AdapterManifest {
  const manifest = registry.get(vendor)?.manifest ?? credentialVendors.get(vendor);
  if (!manifest) {
    const known =
      [...registry.keys(), ...credentialVendors.keys()].sort().join(', ') || '(none)';
    throw new Error(`Unknown vendor '${vendor}'. Registered vendors: ${known}`);
  }
  return manifest;
}

/**
 * List all registered adapter vendor ids, sorted alphabetically.
 * Credential-only vendors are not included: they cannot be passed to `createLlm`.
 */
export function listVendors(): string[] {
  return Array.from(registry.keys()).sort();
}

/**
 * Return an aggregated manifest for all registered vendors, credential-only
 * ones included. Used by api-server's /llm-vendors/manifest endpoint.
 */
export function getManifest(): { vendors: AdapterManifest[] } {
  const vendors = [
    ...Array.from(registry.values()).map((f) => f.manifest),
    ...credentialVendors.values(),
  ]
    .sort((a, b) => a.vendor.localeCompare(b.vendor));
  return { vendors };
}

/**
 * Test-only: reset the registry. Exposed for unit tests that register/unregister
 * adapters and need a clean slate.
 */
export function _resetRegistryForTests(): void {
  registry.clear();
  credentialVendors.clear();
}
