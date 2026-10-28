import { describe, expect, it } from 'vitest';
import {
  createLlm,
  getAdapterFactory,
  getManifest,
  getVendorManifest,
  listVendors,
  normalizeAuth,
  pickAuthKind,
  registerAdapter,
} from '../../src/index.js';
import { templateFactory } from '../../src/adapters/_template/index.js';

describe('credential-only vendors (harness)', () => {
  it('lists harness in the aggregated manifest', () => {
    const harness = getManifest().vendors.find((v) => v.vendor === 'harness');
    expect(harness).toBeDefined();
    expect(harness!.displayName).toBe('Harness');
    expect(harness!.credentialOnly).toBe(true);
  });

  it('declares exactly url and apiKey, both required, key secret', () => {
    const m = getVendorManifest('harness');
    expect(m.authKinds).toHaveLength(1);
    const fields = m.authKinds[0]!.fields;
    expect(fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ['url', 'url', true],
      ['apiKey', 'password', true],
    ]);
  });

  it('has no models and never offers model listing', () => {
    const m = getVendorManifest('harness');
    expect(m.knownModels).toEqual([]);
    expect(m.supportsModelListing).toBe(false);
  });

  it('pickAuthKind resolves the harness form schema', () => {
    const kind = pickAuthKind('harness', { url: 'wss://h.example.com', api_key: 'k' });
    expect(kind.fields.map((f) => f.name)).toEqual(['url', 'apiKey']);
  });

  it('has no adapter: getAdapterFactory and createLlm refuse it', async () => {
    expect(() => getAdapterFactory('harness')).toThrow(/credential-only/);
    await expect(
      createLlm({ vendor: 'harness', auth: { kind: 'apiKey', apiKey: 'k' } }),
    ).rejects.toThrow(/credential-only/);
    expect(listVendors()).not.toContain('harness');
  });

  it('normalizeAuth does not treat it as an LLM vendor', () => {
    expect(() => normalizeAuth('harness', { api_key: 'k' })).toThrow(/unknown vendor/);
  });

  it('getVendorManifest throws for unknown vendors', () => {
    expect(() => getVendorManifest('nope')).toThrow(/Unknown vendor 'nope'/);
  });

  it('an adapter cannot take a credential-only vendor id', () => {
    expect(() =>
      registerAdapter({
        ...templateFactory,
        vendor: 'harness',
        manifest: { ...templateFactory.manifest, vendor: 'harness' },
      }),
    ).toThrow(/already registered/);
  });
});
