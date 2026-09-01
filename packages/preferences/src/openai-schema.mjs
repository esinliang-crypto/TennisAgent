import {
  allowedDirections,
  allowedFeatures,
  allowedImportance,
} from './schema.mjs';

const timeSchema = {
  type: ['string', 'null'],
  pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
};

const ruleSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['before', 'after', 'equals'],
  properties: {
    before: timeSchema,
    after: timeSchema,
    equals: timeSchema,
  },
};

const softPreferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'type', 'importance', 'direction', 'target', 'rule'],
  properties: {
    feature: {
      type: 'string',
      enum: [...allowedFeatures],
    },
    type: {
      type: 'string',
      enum: ['soft'],
    },
    importance: {
      type: 'string',
      enum: [...allowedImportance],
    },
    direction: {
      type: ['string', 'null'],
      enum: [...allowedDirections, null],
    },
    target: {
      type: ['boolean', 'null'],
    },
    rule: ruleSchema,
  },
};

const hardConstraintSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['feature', 'type', 'importance', 'direction', 'target', 'rule'],
  properties: {
    feature: {
      type: 'string',
      enum: [...allowedFeatures],
    },
    type: {
      type: 'string',
      enum: ['hard'],
    },
    importance: {
      type: 'string',
      enum: [...allowedImportance],
    },
    direction: {
      type: ['string', 'null'],
      enum: [...allowedDirections, null],
    },
    target: {
      type: ['boolean', 'null'],
    },
    rule: ruleSchema,
  },
};

const openAiPreferenceProfileJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'searchWindowDays',
    'preferences',
    'hardConstraints',
    'unresolvedPreferences',
    'sourceText',
    'updatedAt',
  ],
  properties: {
    version: { type: 'integer', enum: [1] },
    searchWindowDays: { type: 'integer', minimum: 1, maximum: 30 },
    preferences: {
      type: 'array',
      items: softPreferenceSchema,
    },
    hardConstraints: {
      type: 'array',
      items: hardConstraintSchema,
    },
    unresolvedPreferences: {
      type: 'array',
      items: { type: 'string' },
    },
    sourceText: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

function collectObjectSchemas(schema, path = '#', out = []) {
  if (!schema || typeof schema !== 'object') return out;

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('object')) {
    out.push({ path, schema });
  }

  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    collectObjectSchemas(child, `${path}/properties/${key}`, out);
  }

  if (schema.items) collectObjectSchemas(schema.items, `${path}/items`, out);
  for (const [key, child] of Object.entries(schema.$defs ?? {})) {
    collectObjectSchemas(child, `${path}/$defs/${key}`, out);
  }

  return out;
}

function assertOpenAiStrictObjectSchema(schema) {
  const failures = [];

  for (const { path, schema: objectSchema } of collectObjectSchemas(schema)) {
    if (objectSchema.additionalProperties !== false) {
      failures.push(`${path} must set additionalProperties=false`);
    }

    const propertyNames = Object.keys(objectSchema.properties ?? {});
    const required = objectSchema.required ?? [];
    if (!Array.isArray(required)) {
      failures.push(`${path} must have required array`);
      continue;
    }

    for (const propertyName of propertyNames) {
      if (!required.includes(propertyName)) {
        failures.push(`${path} required is missing ${propertyName}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`OpenAI strict schema audit failed:\n${failures.join('\n')}`);
  }

  return true;
}

export {
  assertOpenAiStrictObjectSchema,
  collectObjectSchemas,
  openAiPreferenceProfileJsonSchema,
};
