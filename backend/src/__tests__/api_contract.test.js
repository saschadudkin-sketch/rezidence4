/**
 * API contract policy for OpenAPI responses:
 * - 204 No Content responses may omit `content` entirely.
 * - If `content` is present for any response code, every declared media type must define `schema`.
 * - For `application/json`, `schema` is always required (same strict rule as before).
 */

describe('api contract responses', () => {
  function assertOperationResponsesHaveSchema(openapi) {
    for (const [path, pathItem] of Object.entries(openapi.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem || {})) {
        const responses = operation?.responses || {};

        for (const [statusCode, response] of Object.entries(responses)) {
          // 204 responses are allowed to omit content by contract.
          if (statusCode === '204' && !response?.content) {
            continue;
          }

          const content = response?.content;
          if (!content) {
            throw new Error(
              `Missing content for ${method.toUpperCase()} ${path} (${statusCode})`,
            );
          }

          for (const [mediaType, mediaObject] of Object.entries(content)) {
            if (!mediaObject?.schema) {
              throw new Error(
                `Missing schema for ${method.toUpperCase()} ${path} (${statusCode}) media type ${mediaType}`,
              );
            }
          }

          if (content['application/json'] && !content['application/json']?.schema) {
            throw new Error(
              `Missing schema for ${method.toUpperCase()} ${path} (${statusCode}) media type application/json`,
            );
          }
        }
      }
    }
  }

  test('all declared operations have response schema', () => {
    const openapi = {
      paths: {
        '/requests': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: { type: 'array' },
                  },
                },
              },
              204: {
                description: 'No Content',
              },
              206: {
                content: {
                  'text/plain': {
                    schema: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };

    expect(() => assertOperationResponsesHaveSchema(openapi)).not.toThrow();
  });

  test('fails when JSON response is missing schema', () => {
    const openapi = {
      paths: {
        '/broken': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {},
                },
              },
            },
          },
        },
      },
    };

    expect(() => assertOperationResponsesHaveSchema(openapi)).toThrow(
      /application\/json/,
    );
  });

  test('passes when 204 response has no content', () => {
    const openapi = {
      paths: {
        '/empty': {
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

    expect(() => assertOperationResponsesHaveSchema(openapi)).not.toThrow();
  });
});
