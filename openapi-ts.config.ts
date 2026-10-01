import { resolve } from 'node:path';

import { defineConfig } from '@hey-api/openapi-ts';
const input = process.env.TEXTIFY_OPENAPI_SOURCE;

if (input === undefined || input.trim() === '') {
  throw new Error('TEXTIFY_OPENAPI_SOURCE must name an authoritative local OpenAPI path or URL.');
}

const resolvedInput = URL.canParse(input) ? input : resolve(input);

export default defineConfig({
  input: resolvedInput,
  output: {
    path: process.env.TEXTIFY_OPENAPI_OUTPUT ?? 'src/generated/textify-api',
    clean: true,
    entryFile: false,
    source: true,
  },
  plugins: [
    {
      name: '@hey-api/typescript',
      definitions: {
        name: '{{name}}',
      },
      responses: {
        name: '{{name}}Responses',
        response: '{{name}}Response',
      },
    },
    {
      name: 'zod',
      definitions: true,
      responses: true,
      requests: false,
      dates: {
        offset: true,
      },
    },
  ],
});
