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

describe('vendor categories', () => {
  it('every vendor in the manifest has a category; language models default to llm', () => {
    const vendors = getManifest().vendors;
    expect(vendors.every((v) => ['llm', 's2s', 'hosted'].includes(v.category!))).toBe(true);
    const cat = (id: string) => vendors.find((v) => v.vendor === id)?.category;
    expect([cat('openai'), cat('harness'), cat('openai_s2s'), cat('dialogflow_ces')]).toEqual([
      'llm',
      'llm',
      's2s',
      'hosted',
    ]);
  });

  it('openai_s2s is credential-only with one required secret key', () => {
    const m = getVendorManifest('openai_s2s');
    expect(m.credentialOnly).toBe(true);
    expect(m.authKinds[0]!.fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ['apiKey', 'password', true],
    ]);
    expect(() => getAdapterFactory('openai_s2s')).toThrow(/credential-only/);
    expect(listVendors()).not.toContain('openai_s2s');
  });

  it('rime_s2s is a credential-only speech-to-speech vendor with one required secret key', () => {
    const m = getVendorManifest('rime_s2s');
    expect(m.credentialOnly).toBe(true);
    expect(m.category).toBe('s2s');
    expect(m.authKinds[0]!.fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ['apiKey', 'password', true],
    ]);
    expect(() => getAdapterFactory('rime_s2s')).toThrow(/credential-only/);
    expect(listVendors()).not.toContain('rime_s2s');
  });

  it('gptlive_s2s is a credential-only speech-to-speech vendor with one required secret key', () => {
    const m = getVendorManifest('gptlive_s2s');
    expect(m.credentialOnly).toBe(true);
    expect(m.category).toBe('s2s');
    expect(m.authKinds[0]!.fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ['apiKey', 'password', true],
    ]);
    expect(() => getAdapterFactory('gptlive_s2s')).toThrow(/credential-only/);
    expect(listVendors()).not.toContain('gptlive_s2s');
  });

  it('ultravox_s2s is a credential-only speech-to-speech vendor with one required secret key', () => {
    const m = getVendorManifest('ultravox_s2s');
    expect(m.credentialOnly).toBe(true);
    expect(m.category).toBe('s2s');
    expect(m.authKinds[0]!.fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ['apiKey', 'password', true],
    ]);
    expect(() => getAdapterFactory('ultravox_s2s')).toThrow(/credential-only/);
    expect(listVendors()).not.toContain('ultravox_s2s');
  });

  it.each(['deepgram_s2s', 'elevenlabs_s2s'])(
    '%s is a credential-only speech-to-speech vendor with one required secret key',
    (vendor) => {
      const m = getVendorManifest(vendor);
      expect(m.credentialOnly).toBe(true);
      expect(m.category).toBe('s2s');
      expect(m.authKinds[0]!.fields.map((f) => [f.name, f.type, f.required])).toEqual([
        ['apiKey', 'password', true],
      ]);
      expect(() => getAdapterFactory(vendor)).toThrow(/credential-only/);
      expect(listVendors()).not.toContain(vendor);
    },
  );

  it('dialogflow_ces is credential-only with a service-account key file', () => {
    const m = getVendorManifest('dialogflow_ces');
    expect(m.credentialOnly).toBe(true);
    expect(m.authKinds[0]!.fields.map((f) => [f.name, f.type, f.required])).toEqual([
      ['credentials', 'json-file', true],
    ]);
    expect(pickAuthKind('dialogflow_ces', { service_key: '{}' }).kind).toBe('googleServiceAccount');
    expect(() => normalizeAuth('dialogflow_ces', { service_key: '{}' })).toThrow(/unknown vendor/);
  });
});
