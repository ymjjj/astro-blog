#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import path from 'node:path';

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const operationNames = [
  'list',
  'read',
  'create',
  'update',
  'image',
  'check',
  'preview',
  'publish',
  'status',
  'config',
];
let contractsPromise;

function loadContracts() {
  contractsPromise ??= import('./contracts.mjs');
  return contractsPromise;
}

function makeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.publicMessage = message;
  if (details !== undefined) error.details = details;
  return error;
}

function writeJson(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

async function writeError(error) {
  try {
    const { errorResult } = await loadContracts();
    writeJson(errorResult(error));
  } catch {
    writeJson({
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.publicMessage || 'The operation could not be completed.',
      },
    });
  }
}

function printHelp(operations) {
  const operationLines = operations
    ? Object.entries(operations)
        .map(([name, operation]) => `  ${name.padEnd(10)} ${operation.description}`)
        .join('\n')
    : operationNames.map((name) => `  ${name}`).join('\n');

  process.stdout.write(
    [
      'Usage:',
      '  node tools/blog/cli.mjs <operation> --input <json-file> --json [--root <absolute-path>]',
      '  node tools/blog/cli.mjs <operation> --stdin [--json] [--root <absolute-path>]',
      '  node tools/blog/cli.mjs <operation> [--json] [--root <absolute-path>]',
      '',
      'Options:',
      '  --input <file>  Read operation arguments from a JSON file.',
      '  --stdin         Read the complete standard input as JSON.',
      '  --root <path>   Use this absolute project directory.',
      '  --json          Accepted for explicit JSON output (JSON is always the output format).',
      '  --help          Show this help.',
      '',
      'With no --input or --stdin, operation arguments default to {}.',
      '',
      'Operations:',
      operationLines,
      '',
      'Examples:',
      '  node tools/blog/cli.mjs list --json',
      '  node tools/blog/cli.mjs read --input request.json --json',
      '  echo "{}" | node tools/blog/cli.mjs config --stdin',
      '',
    ].join('\n'),
  );
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        input: { type: 'string' },
        stdin: { type: 'boolean' },
        json: { type: 'boolean' },
        root: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
  } catch (error) {
    await writeError(makeError('INVALID_INPUT', error.message));
    return;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    let operations;
    try {
      ({ operations } = await loadContracts());
    } catch {
      // Keep help available while dependencies or the core are being installed.
    }
    printHelp(operations);
    return;
  }

  let operations;
  try {
    ({ operations } = await loadContracts());
  } catch (error) {
    await writeError(error);
    return;
  }

  if (positionals.length !== 1 || !Object.hasOwn(operations, positionals[0])) {
    await writeError(makeError('INVALID_INPUT', 'Specify one valid blog operation.'));
    return;
  }

  if (values.input !== undefined && values.stdin) {
    await writeError(makeError('INVALID_INPUT', 'Use either --input or --stdin, not both.'));
    return;
  }

  const root = values.root ?? defaultRoot;
  if (!path.isAbsolute(root)) {
    await writeError(makeError('INVALID_INPUT', '--root must be an absolute path.'));
    return;
  }

  let args = {};
  try {
    if (values.input !== undefined) {
      let source;
      try {
        source = await readFile(values.input, 'utf8');
      } catch {
        throw makeError('INPUT_READ_FAILED', 'Could not read the input JSON file.');
      }
      try {
        args = JSON.parse(source.replace(/^\uFEFF/, ''));
      } catch (error) {
        throw makeError('INVALID_JSON', 'The input file does not contain valid JSON.');
      }
    } else if (values.stdin) {
      let source;
      try {
        source = await readStdin();
      } catch {
        throw makeError('INPUT_READ_FAILED', 'Could not read JSON from standard input.');
      }
      try {
        args = JSON.parse(source.replace(/^\uFEFF/, ''));
      } catch (error) {
        throw makeError('INVALID_JSON', 'Standard input does not contain valid JSON.');
      }
    }

    const { createBlog } = await import('./core.mjs');
    const blog = createBlog(root);
    const result = await blog.execute(positionals[0], args);
    writeJson(result);
  } catch (error) {
    await writeError(error);
  }
}

await main();
