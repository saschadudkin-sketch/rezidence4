function validateOperationResponseSchemas(spec) {
  const errors = [];

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!operation || typeof operation !== 'object') continue;

      for (const [statusCode, response] of Object.entries(operation.responses || {})) {
        const content = response?.content;

        // Rule for contract stability:
        // - 204 may omit content entirely;
        // - if content exists, every media type must include schema;
        // - application/json always requires schema (same as before).
        if (String(statusCode) === '204' && !content) {
          continue;
        }

        if (!content || typeof content !== 'object') {
          errors.push(`${method.toUpperCase()} ${path} ${statusCode}: missing content`);
          continue;
        }

        for (const [mediaType, mediaTypeObject] of Object.entries(content)) {
          if (!mediaTypeObject || !mediaTypeObject.schema) {
            errors.push(
              `${method.toUpperCase()} ${path} ${statusCode} ${mediaType}: missing schema`,
            );
          }
        }
      }
    }
  }

  return errors;
}

describe('OpenAPI contract', () => {
  test('all declared operations have response schema', () => {
    const spec = {
      paths: {
        '/users': {
          get: {
            responses: {
              200: {
                description: 'Users list',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
              204: {
                description: 'No content',
              },
            },
          },
        },
      },
    };

    expect(validateOperationResponseSchemas(spec)).toEqual([]);
  });

  test('JSON without schema = fail', () => {
    const spec = {
      paths: {
        '/health': {
          get: {
            responses: {
              200: {
                description: 'Health check',
                content: {
                  'application/json': {},
                },
              },
            },
          },
        },
      },
    };

    expect(validateOperationResponseSchemas(spec)).toEqual([
      'GET /health 200 application/json: missing schema',
    ]);
  });

  test('204 without content = pass', () => {
    const spec = {
      paths: {
        '/health': {
          delete: {
            responses: {
              204: {
                description: 'Deleted',
              },
            },
          },
        },
      },
    };

    expect(validateOperationResponseSchemas(spec)).toEqual([]);
  });
});
