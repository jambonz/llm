import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetRegistryForTests,
  getManifest,
  registerAdapter,
} from '../../src/registry.js';
import { templateFactory } from '../../src/adapters/_template/index.js';
import type {
  AdapterFactory,
  AdapterManifest,
  FormFieldType,
} from '../../src/types.js';

const VALID_FIELD_TYPES: ReadonlyArray<FormFieldType> = [
  'text',
  'password',
  'url',
  'json-file',
  'select',
];

/** Contract: an `AdapterManifest` must satisfy these structural rules. */
function assertWellFormed(m: AdapterManifest): void {
  expect(m.vendor).toMatch(/^[a-z][a-z0-9-]*$/);
  expect(m.displayName.length).toBeGreaterThan(0);
  expect(m.authKinds.length).toBeGreaterThan(0);
  for (const ak of m.authKinds) {
    expect(ak.displayName.length).toBeGreaterThan(0);
    for (const field of ak.fields) {
      expect(field.name.length).toBeGreaterThan(0);
      expect(field.label.length).toBeGreaterThan(0);
      expect(VALID_FIELD_TYPES).toContain(field.type);
      if (field.type === 'select') {
        expect(field.options).toBeDefined();
        expect(field.options!.length).toBeGreaterThan(0);
      }
    }
  }
  expect(m.knownModels.length).toBeGreaterThan(0);
  for (const model of m.knownModels) {
    expect(model.id.length).toBeGreaterThan(0);
    expect(typeof model.capabilities.streaming).toBe('boolean');
    expect(typeof model.capabilities.tools).toBe('boolean');
    expect(typeof model.capabilities.vision).toBe('boolean');
    expect(typeof model.capabilities.systemPrompt).toBe('boolean');
  }
  expect(typeof m.supportsModelListing).toBe('boolean');
}

describe('manifest', () => {
  beforeEach(() => _resetRegistryForTests());
  afterEach(() => _resetRegistryForTests());

  it('template manifest is well-formed', () => {
    assertWellFormed(templateFactory.manifest);
  });

  it('getManifest() is JSON-serializable (safe to send over HTTP)', () => {
    registerAdapter(templateFactory);
    const manifest = getManifest();
    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(manifest);
  });

  it('getManifest() aggregates multiple adapters sorted by vendor id', () => {
    const zebra: AdapterFactory = {
      vendor: 'zebra',
      manifest: { ...templateFactory.manifest, vendor: 'zebra', displayName: 'Zebra' },
      create: templateFactory.create,
    };
    const apple: AdapterFactory = {
      vendor: 'apple',
      manifest: { ...templateFactory.manifest, vendor: 'apple', displayName: 'Apple' },
      create: templateFactory.create,
    };
    registerAdapter(zebra);
    registerAdapter(templateFactory);
    registerAdapter(apple);

    const manifest = getManifest();
    expect(manifest.vendors.map((v) => v.vendor)).toEqual(['apple', 'template', 'zebra']);
  });

  it('select-type fields without options cause structural check to fail', () => {
    const bad: AdapterManifest = {
      ...templateFactory.manifest,
      vendor: 'bad',
      authKinds: [
        {
          kind: 'apiKey',
          displayName: 'API Key',
          fields: [
            // Invalid: select without options
            { name: 'region', label: 'Region', type: 'select', required: true },
          ],
        },
      ],
    };
    expect(() => assertWellFormed(bad)).toThrow();
  });

  it('unknown field type is caught by structural check', () => {
    const bad = {
      ...templateFactory.manifest,
      vendor: 'bad',
      authKinds: [
        {
          kind: 'apiKey' as const,
          displayName: 'API Key',
          fields: [
            { name: 'foo', label: 'Foo', type: 'bogus' as FormFieldType, required: true },
          ],
        },
      ],
    };
    expect(() => assertWellFormed(bad)).toThrow();
  });
});
