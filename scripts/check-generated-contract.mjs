import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = process.env.TEXTIFY_OPENAPI_SOURCE;
const expectedOutput = join(repoRoot, 'src/generated/textify-api');
const generator = join(repoRoot, 'node_modules/@hey-api/openapi-ts/bin/run.js');

if (source === undefined || source.trim() === '') {
  process.stderr.write('TEXTIFY_OPENAPI_SOURCE must name an authoritative local OpenAPI path or URL.\n');
  process.exitCode = 1;
} else {
  const temporaryOutput = await mkdtemp(join(tmpdir(), 'textify-openapi-'));

  try {
    const { promise, reject, resolve } = Promise.withResolvers();
    const child = spawn(process.execPath, [generator, '--silent'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        TEXTIFY_OPENAPI_OUTPUT: temporaryOutput,
      },
      stdio: 'ignore',
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      resolve(code ?? 1);
    });
    const exitCode = await promise;

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    } else {
      const [expectedFiles, actualFiles] = await Promise.all([
        listFiles(expectedOutput),
        listFiles(temporaryOutput),
      ]);
      const comparedFiles = new Set([...expectedFiles, ...actualFiles]);
      const differingFiles = [];

      for (const file of [...comparedFiles].sort()) {
        const expectedFile = join(expectedOutput, file);
        const actualFile = join(temporaryOutput, file);
        const [hasExpectedFile, hasActualFile] = await Promise.all([
          fileExists(expectedFile),
          fileExists(actualFile),
        ]);

        if (!hasExpectedFile || !hasActualFile) {
          differingFiles.push(file);
          continue;
        }

        const [expectedContents, actualContents] = await Promise.all([
          readFile(expectedFile),
          readFile(actualFile),
        ]);

        if (!expectedContents.equals(actualContents)) {
          differingFiles.push(file);
        }
      }

      if (differingFiles.length > 0) {
        process.stdout.write(`${differingFiles.join('\n')}\n`);
        process.exitCode = 1;
      }
    }
  } finally {
    await rm(temporaryOutput, { force: true, recursive: true });
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await listFiles(path);
      files.push(...nestedFiles.map((file) => join(entry.name, file)));
    } else if (entry.isFile()) {
      files.push(relative(directory, path));
    }
  }

  return files;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
