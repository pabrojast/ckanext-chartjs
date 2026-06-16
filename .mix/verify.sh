#!/usr/bin/env bash
# Verification gate for ckanext-chartjs.
# No CKAN instance is available headless, so this validates: Python compile,
# JS syntax, Jinja parse (all static/weak) PLUS a behavioral test of the
# pure chart_config validation helper (strong for that unit).
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
import sys, glob
try:
    from jinja2 import Environment
except ImportError:
    print("  SKIP (jinja2 not installed)")
    sys.exit(0)
env = Environment()
ok = True
for f in sorted(glob.glob('ckanext/chartjs/templates/*.html')):
    try:
        env.parse(open(f, encoding='utf-8').read())
        print("  OK:", f)
    except Exception as e:
        print("  FAIL:", f, e); ok = False
sys.exit(0 if ok else 1)
PY
fi

echo "== Behavioral: _validate_chart_config (extracted) =="
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY' || fail=1
import ast, json, os, sys
src = open('ckanext/chartjs/api.py', encoding='utf-8').read()
tree = ast.parse(src)
ns = {'json': json, 'os': os}
funcs = {'_clean_string','_coerce_bool','_clamp_int','_validate_chart_config','_is_cj_debug'}
assigns = {'_ALLOWED_CHART_TYPES','_ALLOWED_AGG','_ALLOWED_SORT','_MAX_CONFIG_BYTES',
           '_MAX_TEXT','_MAX_SHORT','_MAX_TINY','_MAX_SERIES'}
mod = ast.Module(body=[], type_ignores=[])
for n in tree.body:
    if isinstance(n, ast.FunctionDef) and n.name in funcs:
        mod.body.append(n)
    elif isinstance(n, ast.Assign) and any(getattr(t,'id',None) in assigns for t in n.targets):
        mod.body.append(n)
exec(compile(mod, 'extracted', 'exec'), ns)
V = ns['_validate_chart_config']
bad = []
def ck(name, cond):
    if not cond: bad.append(name)

front = {"version":1,"chartType":"bar","title":"Ventas & Marketing (>65)","xAxis":"region",
  "series":[{"yField":"sales","label":"Sales","aggregation":"sum","color":"#FF6384"},
            {"yField":"cost","label":"Cost","aggregation":"average","color":"#36A2EB"}],
  "options":{"showLegend":True,"showGrid":True,"stacked":False,"beginAtZero":True,
             "categorySort":"value_desc","topN":10,"showOthers":True,"othersLabel":"Otros",
             "xAxisTitle":"Region","yAxisTitle":"CLP","horizontalBars":True,
             "numberFormat":{"decimalsMode":"fixed","decimals":2,"useThousands":True,"prefix":"$","suffix":""}}}
out = json.loads(V(json.dumps(front)))
ck("title keeps & >", out["title"]=="Ventas & Marketing (>65)")
ck("option keys", set(out["options"].keys())=={"showLegend","showGrid","stacked","beginAtZero",
   "showOthers","horizontalBars","categorySort","topN","othersLabel","xAxisTitle","yAxisTitle",
   "timeAxis","timeUnit","numberFormat"})
ck("numberFormat intact", out["options"]["numberFormat"]["prefix"]=="$")
o6 = json.loads(V(json.dumps({"chartType":"bar","series":[{"yField":"a","aggregation":"median"}],
     "options":{"topN":99999,"stacked":"false","showLegend":"true"}})))
ck("topN clamp", o6["options"]["topN"]==100)
ck("bad agg->sum", o6["series"][0]["aggregation"]=="sum")
ck("'false'->False", o6["options"]["stacked"] is False)
for b in ["[]","\"s\"","5","null"]:
    try: V(b); ck("reject "+b, False)
    except ValueError: pass
try: V(json.dumps({"chartType":"x"})); ck("reject bad type", False)
except ValueError: pass
try: V(json.dumps({"chartType":"bar","title":"x"*70000})); ck("reject oversized", False)
except ValueError: pass
ck("series cap", len(json.loads(V(json.dumps({"chartType":"bar","series":[{"yField":str(i)} for i in range(80)]})))["series"])==50)
ck("unknown dropped", "evil" not in json.loads(V(json.dumps({"chartType":"line","evil":1}))))
if bad:
    print("  FAIL:", bad); sys.exit(1)
print("  OK (all config-validation assertions passed)")
PY
fi

echo "== pytest (datautils) =="
if command -v python3 >/dev/null 2>&1 && python3 -c "import pytest" 2>/dev/null; then
  python3 -m pytest tests/ -q && echo "  OK" || { echo "  FAIL"; fail=1; }
else
  echo "  SKIP (pytest not available)"
fi

echo "== node JS unit tests =="
if command -v node >/dev/null 2>&1; then
  node tests/chartjs-ckan.test.js && echo "  OK" || { echo "  FAIL"; fail=1; }
else
  echo "  SKIP (node not found)"
fi

if [ "$fail" -ne 0 ]; then echo "VERIFY: FAIL"; exit 1; fi
echo "VERIFY: PASS"
exit 0
