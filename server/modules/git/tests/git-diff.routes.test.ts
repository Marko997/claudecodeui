import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import express from 'express';

import { createGitRouter } from '@/modules/git/git.routes.js';

type RouterDependencies = Parameters<typeof createGitRouter>[0];

/**
 * Answers the git calls the diff route makes, in order: the work-tree probe,
 * the repository root, and the per-file status that marks the file untracked.
 */
function createGitStub() {
  return ((_command: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    let output = '';
    if (args.includes('--is-inside-work-tree')) {
      output = 'true\n';
    } else if (args.includes('--show-toplevel')) {
      output = '/workspace/repo\n';
    } else if (args[0] === 'status') {
      output = '?? asset.bin\n';
    }

    process.nextTick(() => {
      child.stdout.end(output);
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  }) as RouterDependencies['spawnProcess'];
}

async function requestDiff(fileSystem: RouterDependencies['fileSystem']): Promise<string> {
  const unexpectedProvider = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  const router = createGitRouter({
    fileSystem,
    spawnProcess: createGitStub(),
    resolveProjectPathById: () => '/workspace/repo',
    queryClaude: unexpectedProvider,
    queryCursor: unexpectedProvider,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/git', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/git/diff?project=project-1&file=asset.bin`,
    );
    const body = await response.json() as { diff?: string };
    return body.diff ?? '';
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('an oversized untracked file is summarized and never read into memory', async () => {
  let readFileCalls = 0;
  const fileSystem = {
    access: async () => undefined,
    stat: async () => ({ isDirectory: () => false, size: 6 * 1024 * 1024 }),
    readFile: async () => {
      readFileCalls += 1;
      throw new Error('the route must not read a file this large');
    },
  } as unknown as RouterDependencies['fileSystem'];

  const diff = await requestDiff(fileSystem);

  assert.equal(readFileCalls, 0, 'the size check has to happen before the read');
  assert.match(diff, /too large to display/);
  assert.match(diff, /6\.0 MB/);
});

test('an untracked binary file under the limit is reported without a text diff', async () => {
  // A PNG header: NUL bytes inside the sniffed prefix.
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const fileSystem = {
    access: async () => undefined,
    stat: async () => ({ isDirectory: () => false, size: binary.length }),
    readFile: async () => binary,
  } as unknown as RouterDependencies['fileSystem'];

  const diff = await requestDiff(fileSystem);

  assert.match(diff, /binary file/i);
  assert.equal(diff.includes('+'), false, 'binary content must not be inlined as additions');
});

test('a small text file still renders as a full-addition diff', async () => {
  const fileSystem = {
    access: async () => undefined,
    stat: async () => ({ isDirectory: () => false, size: 12 }),
    readFile: async () => Buffer.from('alpha\nbeta\n'),
  } as unknown as RouterDependencies['fileSystem'];

  const diff = await requestDiff(fileSystem);

  assert.match(diff, /^--- \/dev\/null/);
  assert.match(diff, /\+alpha/);
  assert.match(diff, /\+beta/);
});
