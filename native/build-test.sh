#!/bin/bash

# Builds a Node.js-compatible version of the xdelta3 WASM module for automated testing.
# Reuses the .o files already produced by build.sh (run build.sh first).

set -euxo pipefail

BASE="./native"
OBJS="./native/out"
XZ_BASE="$BASE/xz/xz-5.4.6"
FLAGS="-O2"

# Verify that the required .o files from build.sh are present
for obj in "$OBJS/xdelta3.o" "$OBJS/xdelta3-wasm.o"; do
  if [ ! -f "$obj" ]; then
    echo "Error: $obj not found. Run ./native/build.sh before ./native/build-test.sh" >&2
    exit 1
  fi
done

emcc -o test/xdelta3-node.js \
  $XZ_BASE/src/liblzma/.libs/liblzma.a \
  $OBJS/xdelta3.o $OBJS/xdelta3-wasm.o \
  $FLAGS \
  -s ENVIRONMENT="node" \
  -s EXPORTED_RUNTIME_METHODS="['callMain', 'UTF8ToString']" \
  -s EXPORTED_FUNCTIONS="['_main']" \
  -s INVOKE_RUN=0 \
  -s INITIAL_MEMORY=52428800 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createXdelta3Module
