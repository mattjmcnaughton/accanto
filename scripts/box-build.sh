#!/usr/bin/env bash
# Build a self-contained Amp Box release in ./box-release: a relocatable
# CPython, the locked runtime dependencies plus accanto (with the built SPA),
# and nothing else. No source tree, tests, fixtures, databases or credentials.
set -euo pipefail

out=box-release
rm -rf "$out" .box-build
mkdir -p "$out" .box-build

pnpm --dir src/accanto/web/frontend install --frozen-lockfile
pnpm --dir src/accanto/web/frontend build

# python-build-standalone interpreters run from any path.
uv python install 3.12 --install-dir .box-build/python --no-bin
cp -a .box-build/python/cpython-3.12*/. "$out/python"
python="$out/python/bin/python3"

uv export --frozen --no-dev --no-emit-project --no-header -o .box-build/requirements.txt
uv pip install --python "$python" --target "$out/site" --require-hashes -r .box-build/requirements.txt
uv build --wheel --out-dir .box-build/dist
uv pip install --python "$python" --target "$out/site" --no-deps .box-build/dist/accanto-*.whl

test -f "$out/site/accanto/web/frontend/dist/index.html"
test -f "$out/site/certifi/cacert.pem"
rm -rf .box-build
