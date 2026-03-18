#!/usr/bin/env node
// Verifies that the xdelta3 WASM module correctly applies an xdelta3 patch.
//
// Flow:
//   1. Write a small source file and a slightly modified target file to a temp dir.
//   2. Use the native xdelta3 CLI to encode a patch (source → target).
//   3. Load the WASM module and decode the patch against the source.
//   4. Assert that the decoded output matches the target exactly.

'use strict';

const createXdelta3Module = require('./xdelta3-node.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

async function runTest() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdelta-test-'));
  const sourceFile = path.join(tmpDir, 'source.bin');
  const targetFile = path.join(tmpDir, 'target.bin');
  const patchFile = path.join(tmpDir, 'patch.vcdiff');

  try {
    // Build source: 64 KiB with a repeating pattern
    const sourceData = Buffer.alloc(64 * 1024);
    for (let i = 0; i < sourceData.length; i++) {
      sourceData[i] = i % 251; // prime to avoid trivial patterns
    }

    // Build target: same data with a handful of changes
    const targetData = Buffer.from(sourceData);
    targetData[0x100] = 0xff;
    targetData[0x200] = 0xaa;
    targetData[0x3000] = 0x42;
    targetData[0x8000] = 0x00;

    fs.writeFileSync(sourceFile, sourceData);
    fs.writeFileSync(targetFile, targetData);

    // Encode the patch using the native xdelta3 CLI
    const encodeResult = spawnSync(
      'xdelta3',
      ['encode', '-s', sourceFile, targetFile, patchFile],
      { stdio: 'pipe' }
    );
    if (encodeResult.status !== 0) {
      throw new Error(
        'xdelta3 encode failed: ' + (encodeResult.stderr || '').toString()
      );
    }

    // Read the files that the WASM module will stream
    const sourceBytes = fs.readFileSync(sourceFile);
    const patchBytes = fs.readFileSync(patchFile);
    const bufferSize = 4 * 1024 * 1024;

    // Collect WASM output chunks
    const outputChunks = [];
    let wasmError = null;

    const module = await createXdelta3Module();

    module.readSource = function (buffer, offset, size) {
      const end = Math.min(sourceBytes.length, offset + size);
      module.HEAP8.set(sourceBytes.slice(offset, end), buffer);
      return end - offset;
    };

    module.readPatch = function (buffer, offset, size) {
      const end = Math.min(patchBytes.length, offset + size);
      module.HEAP8.set(patchBytes.slice(offset, end), buffer);
      return end - offset;
    };

    module.outputFile = function (buffer, size) {
      const view = new Uint8Array(module.HEAP8.buffer, buffer, size);
      outputChunks.push(Buffer.from(view));
    };

    module.reportError = function (buffer) {
      wasmError = module.UTF8ToString(buffer);
    };

    const result = module.callMain([bufferSize.toString(), 'false']);

    if (result !== 0) {
      throw new Error(
        `WASM module exited with code ${result}${wasmError ? ': ' + wasmError : ''}`
      );
    }

    const output = Buffer.concat(outputChunks);

    if (output.length !== targetData.length) {
      throw new Error(
        `Output length mismatch: expected ${targetData.length} bytes, got ${output.length} bytes`
      );
    }

    if (!output.equals(targetData)) {
      // Find the first differing byte for a helpful error message
      let firstDiff = -1;
      for (let i = 0; i < output.length; i++) {
        if (output[i] !== targetData[i]) {
          firstDiff = i;
          break;
        }
      }
      throw new Error(
        `Output content mismatch: first difference at byte 0x${firstDiff.toString(16)}`
      );
    }

    console.log('✓ Patch test passed: WASM output matches expected target');
  } finally {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

runTest().catch((err) => {
  console.error('✗ Patch test failed:', err.message);
  process.exit(1);
});
