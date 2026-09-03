const REPLANNING_ACTIONS = Object.freeze({
  EXPAND_RADIUS: 'EXPAND_RADIUS',
  EXPAND_DATE_WINDOW: 'EXPAND_DATE_WINDOW',
  SHIFT_TIME_WINDOW: 'SHIFT_TIME_WINDOW',
  INCLUDE_NONPREFERRED_COURTS: 'INCLUDE_NONPREFERRED_COURTS',
  RELAX_PRICE: 'RELAX_PRICE',
  SEARCH_OTHER_VENUES: 'SEARCH_OTHER_VENUES',
  ASK_USER: 'ASK_USER',
  STOP: 'STOP',
});

const allowedReplanningActions = new Set(Object.values(REPLANNING_ACTIONS));

class ReplanningActionSchemaError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'ReplanningActionSchemaError';
    this.code = 'REPLANNING_ACTION_SCHEMA_ERROR';
    this.issues = issues;
  }
}

function validateReplanningAction(action) {
  const issues = [];

  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw new ReplanningActionSchemaError('Replanning action must be an object', ['action must be an object']);
  }

  for (const key of Object.keys(action)) {
    if (!['selectedAction', 'targetPreference', 'rationale', 'expectedEffect'].includes(key)) {
      issues.push(`${key} is not allowed`);
    }
  }

  if (!allowedReplanningActions.has(action.selectedAction)) {
    issues.push(`selectedAction must be one of ${[...allowedReplanningActions].join(', ')}`);
  }

  if (action.targetPreference !== null
    && action.targetPreference !== undefined
    && typeof action.targetPreference !== 'string') {
    issues.push('targetPreference must be a string or null');
  }

  if (typeof action.rationale !== 'string' || action.rationale.length === 0) {
    issues.push('rationale must be a non-empty string');
  }

  if (typeof action.expectedEffect !== 'string' || action.expectedEffect.length === 0) {
    issues.push('expectedEffect must be a non-empty string');
  }

  if (issues.length > 0) {
    throw new ReplanningActionSchemaError('Invalid replanning action', issues);
  }

  return {
    selectedAction: action.selectedAction,
    targetPreference: action.targetPreference ?? null,
    rationale: action.rationale,
    expectedEffect: action.expectedEffect,
  };
}

const replanningActionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['selectedAction', 'targetPreference', 'rationale', 'expectedEffect'],
  properties: {
    selectedAction: {
      type: 'string',
      enum: [...allowedReplanningActions],
    },
    targetPreference: {
      type: ['string', 'null'],
    },
    rationale: {
      type: 'string',
    },
    expectedEffect: {
      type: 'string',
    },
  },
};

export {
  REPLANNING_ACTIONS,
  ReplanningActionSchemaError,
  allowedReplanningActions,
  replanningActionJsonSchema,
  validateReplanningAction,
};
