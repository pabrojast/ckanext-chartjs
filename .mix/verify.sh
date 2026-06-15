#!/usr/bin/env bash
# Static verification gate for ckanext-chartjs.
# This repo has no test suite and runtime checks need a live CKAN instance,
# so this validates syntax/parsing only (Python compile, JS check, Jinja parse).
# It does NOT prove runtime behavior (chart render, embed route, auth).
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0

echo "== Python py_compile =="
if command -v python3 >/dev/null 2>&1; then
  python3 -m py_compile ckanext/chartjs/api.py ckanext/chartjs/plugin.py \
    && echo "  OK" || { echo "  FAIL"; fail=1; }
else
  echo "  SKIP (python3 not found)"
fi

echo "== JS node --check =="
if command -v node >/dev/null 2>&1; then
  node --check ckanext/chartjs/public/chartjs-app/chartjs-ckan.js \
    && echo "  OK" || { echo "  FAIL"; fail=1; }
else
  echo "  SKIP (node not found)"
fi

echo "== Jinja2 template parse =="
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' || fail=1
import sys
try:
    from jinja2 import Environment
except ImportError:
    print("  SKIP (jinja2 not installed)")
    sys.exit(0)
env = Environment()
ok = True
for f in ['ckanext/chartjs/templates/chartjs_view.html',
          'ckanext/chartjs/templates/chartjs_embed.html']:
    try:
        env.parse(open(f, encoding='utf-8').read())
        print("  OK:", f)
    except Exception as e:
        print("  FAIL:", f, e)
        ok = False
sys.exit(0 if ok else 1)
PY
fi

if [ "$fail" -ne 0 ]; then
  echo "VERIFY: FAIL"
  exit 1
fi
echo "VERIFY: PASS (static only)"
exit 0
