import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetRegistryForTests,
  getAdapterFactory,
  getManifest,
  listVendors,
  registerAdapter,
  replaceAdapter,
  unregisterAdapter,
} from '../../src/registry.js';
import { templateFactory } from '../../src/adapters/_template/index.js';
import type { AdapterFactory } from '../../src/types.js';

describe('registry', () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  afterEach(() => {
    _resetRegistryForTests();
  });

  it('registers an adapter by vendor id', () => {
    registerAdapter(templateFactory);
    expect(listVendors()).toEqual(['template']);
  });

  it('looks up a registered adapter by vendor id', () => {
    registerAdapter(templateFactory);
    const factory = getAdapterFactory('template');
    expect(factory.vendor).toBe('template');
    expect(factory.manifest.displayName).toBe('Template Vendor');
  });

  it('throws on lookup of unknown vendor, listing known vendors', () => {
    registerAdapter(templateFactory);
    expect(() => getAdapterFactory('nope')).toThrowError(
      /Unknown vendor 'nope'\. Registered vendors: template/,
    );
  });

  it('throws on lookup when registry is empty', () => {
    expect(() => getAdapterFactory('anything')).toThrowError(
      /Unknown vendor 'anything'\. Registered vendors: \(none\)/,
    );
  });

  it('rejects double registration of the same vendor', () => {
    registerAdapter(templateFactory);
    expect(() => registerAdapter(templateFactory)).toThrowError(
      /Adapter already registered for vendor 'template'/,
    );
  });

  it('rejects a factory whose vendor does not match its manifest vendor', () => {
    const broken: AdapterFactory = {
      vendor: 'foo',
      manifest: { ...templateFactory.manifest, vendor: 'bar' },
      create: templateFactory.create,
    };
    expect(() => registerAdapter(broken)).toThrowError(
      /vendor 'foo' does not match manifest\.vendor 'bar'/,
    );
  });

  it('replaceAdapter overrides without throwing', () => {
    registerAdapter(templateFactory);
    const override: AdapterFactory = {
      vendor: 'template',
      manifest: { ...templateFactory.manifest, displayName: 'Overridden' },
      create: templateFactory.create,
    };
    replaceAdapter(override);
    expect(getAdapterFactory('template').manifest.displayName).toBe('Overridden');
  });

  it('unregisterAdapter removes a vendor', () => {
    registerAdapter(templateFactory);
    unregisterAdapter('template');
    expect(listVendors()).toEqual([]);
  });

  it('listVendors returns sorted ids', () => {
    const zebra: AdapterFactory = {
      vendor: 'zebra',
      manifest: { ...templateFactory.manifest, vendor: 'zebra' },
      create: templateFactory.create,
    };
    const apple: AdapterFactory = {
      vendor: 'apple',
      manifest: { ...templateFactory.manifest, vendor: 'apple' },
      create: templateFactory.create,
    };
    registerAdapter(zebra);
    registerAdapter(apple);
    registerAdapter(templateFactory);
    expect(listVendors()).toEqual(['apple', 'template', 'zebra']);
  });

  it('getManifest returns a sorted list of manifests', () => {
    const zebra: AdapterFactory = {
      vendor: 'zebra',
      manifest: { ...templateFactory.manifest, vendor: 'zebra' },
      create: templateFactory.create,
    };
    const apple: AdapterFactory = {
      vendor: 'apple',
      manifest: { ...templateFactory.manifest, vendor: 'apple' },
      create: templateFactory.create,
    };
    registerAdapter(zebra);
    registerAdapter(apple);
    const manifest = getManifest();
    expect(manifest.vendors.map((v) => v.vendor)).toEqual(['apple', 'zebra']);
  });

  it('getManifest on empty registry returns empty list', () => {
    expect(getManifest()).toEqual({ vendors: [] });
  });
});
