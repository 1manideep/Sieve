// JSON schemas for the two Nano checks (11 sections 5.5.2 and 8.4.2). 11 places them in shared/src/schemas/; until
// that move (contract change request in the WP3 report) they live here, with the same content.

export const PII_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['name', 'address', 'id'] },
        },
        required: ['text', 'type'],
      },
    },
  },
  required: ['items'],
} as const;

export const INJECTION_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    suspicious: { type: 'boolean' },
    quote: { type: 'string' },
  },
  required: ['suspicious', 'quote'],
} as const;
