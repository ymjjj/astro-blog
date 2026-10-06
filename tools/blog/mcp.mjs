#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { errorResult, operations } from './contracts.mjs';

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));

function reportStartupError(error) {
  process.stderr.write(`${JSON.stringify(errorResult(error))}\n`);
  process.exitCode = 1;
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: { root: { type: 'string' } },
    }));
  } catch (error) {
    reportStartupError(error);
    return;
  }

  const root = values.root ?? defaultRoot;
  if (!path.isAbsolute(root)) {
    const error = new Error('--root must be an absolute path.');
    error.code = 'INVALID_INPUT';
    error.publicMessage = error.message;
    reportStartupError(error);
    return;
  }

  try {
    const { createBlog } = await import('./core.mjs');
    const blog = createBlog(root);
    const server = new McpServer({ name: 'astro-blog', version: '1.0.0' });

    for (const [name, operation] of Object.entries(operations)) {
      server.registerTool(
        `blog_${name}`,
        {
          description: operation.description,
          inputSchema: operation.schema.shape,
          annotations: {
            readOnlyHint: operation.readOnly,
            destructiveHint: !operation.readOnly,
            openWorldHint: name === 'publish' || name === 'status',
          },
        },
        async (args) => {
          let result;
          try {
            result = await blog.execute(name, args);
          } catch (error) {
            result = errorResult(error);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
            isError: !result.ok,
          };
        },
      );
    }

    await server.connect(new StdioServerTransport());
  } catch (error) {
    reportStartupError(error);
  }
}

await main();
