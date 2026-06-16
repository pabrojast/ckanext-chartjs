'use strict';
// formatNumber uses toLocaleString(undefined, ...), which is locale-sensitive
// (a comma vs dot decimal separator). Pin LC_ALL=C so number assertions are
// deterministic regardless of the host locale; re-exec once if not already set.
if (process.env.LC_ALL !== 'C') {
  var cp = require('child_process');
  var r = cp.spawnSync(process.execPath, [__filename], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { LC_ALL: 'C', LANG: 'C' }),
  });
  process.exit(r.status === null ? 1 : r.status);
}

var assert = require('assert');
var cj = require('../ckanext/chartjs/public/chartjs-app/chartjs-ckan.js');

// aggregate
assert.strictEqual(cj.aggregate(['1', '2', '3'], 'sum'), 6);
assert.strictEqual(cj.aggregate(['1', '2', '3'], 'count'), 3);
assert.strictEqual(cj.aggregate(['2', '4'], 'average'), 3);
assert.strictEqual(cj.aggregate(['5', '1', '9'], 'min'), 1);
assert.strictEqual(cj.aggregate(['5', '1', '9'], 'max'), 9);

// formatNumber
assert.strictEqual(cj.formatNumber('x', {}), 'x');           // non-number passes through
assert.strictEqual(cj.formatNumber(1234.5, { decimalsMode: 'fixed', decimals: 2, useThousands: false }), '1234.50');
assert.strictEqual(cj.formatNumber(1000, { decimalsMode: 'fixed', decimals: 0, useThousands: false, prefix: '$' }), '$1000');
assert.strictEqual(cj.formatNumber(50, { decimalsMode: 'auto', suffix: '%' }), '50%');

// sortAggregatedRows (value_desc by row total; ties by label)
var rows = [
  { label: 'a', values: [1] },
  { label: 'b', values: [3] },
  { label: 'c', values: [2] },
];
var desc = cj.sortAggregatedRows(rows, 'value_desc').map(function (r) { return r.label; });
assert.deepStrictEqual(desc, ['b', 'c', 'a']);
var asc = cj.sortAggregatedRows(rows, 'label_asc').map(function (r) { return r.label; });
assert.deepStrictEqual(asc, ['a', 'b', 'c']);

// applyTopNAndOthers: keep top-2 by total, bucket rest as Others
var top = cj.applyTopNAndOthers(rows, 2, true, 'Others');
assert.strictEqual(top.length, 3); // b, c, Others
var others = top[top.length - 1];
assert.strictEqual(others.label, 'Others');
assert.strictEqual(others.values[0], 1); // the remaining 'a' value

// topN=0 returns all unchanged
assert.strictEqual(cj.applyTopNAndOthers(rows, 0, true, 'Others').length, 3);

// --- B5 accessibility pure functions ---
var idt = function (k, f) { return f; };

// categorical table model (bar/line): Category + one series column
var catData = { labels: ['A', 'B'], datasets: [{ label: 'Sales', data: [10, 20] }] };
var m = cj.buildAccessibleTableModel(catData, { chartType: 'bar', title: 'T' }, idt);
assert.strictEqual(m.caption, 'T');
assert.deepStrictEqual(m.headers, ['Category', 'Sales']);
assert.deepStrictEqual(m.rows, [['A', '10'], ['B', '20']]);

// scatter model: Series, X, Y
var scData = { datasets: [{ label: 'S1', data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }] };
var ms = cj.buildAccessibleTableModel(scData, { chartType: 'scatter' }, idt);
assert.deepStrictEqual(ms.headers, ['Series', 'X', 'Y']);
assert.deepStrictEqual(ms.rows, [['S1', '1', '2'], ['S1', '3', '4']]);

// empty model
var me = cj.buildAccessibleTableModel({ datasets: [] }, { chartType: 'bar' }, idt);
assert.strictEqual(me.caption, 'No data to display');
assert.deepStrictEqual(me.rows, []);

// XSS payloads stay LITERAL in the model (rendered later via textContent)
var evil = '<img src=x onerror=alert(1)>';
var mx = cj.buildAccessibleTableModel(
  { labels: [evil], datasets: [{ label: '</td><script>', data: [1] }] },
  { chartType: 'bar' }, idt);
assert.strictEqual(mx.rows[0][0], evil);            // unchanged literal
assert.strictEqual(mx.headers[1], '</td><script>'); // unchanged literal

// aria summary: plain text, includes type + counts, quotes stripped, capped
var sm = cj.buildChartAriaSummary(catData, { chartType: 'bar', title: 'My "Chart"' }, idt);
assert.ok(sm.indexOf('bar chart') !== -1);
assert.ok(sm.indexOf('2 categories') !== -1);
assert.ok(sm.indexOf('"') === -1);                  // double-quotes stripped
assert.ok(sm.length <= 200);
assert.strictEqual(cj.buildChartAriaSummary({ datasets: [] }, { chartType: 'bar' }, idt), 'Chart with no data');

// --- B4 i18n t() helper ---
assert.strictEqual(cj.t('nope.key', 'fallback'), 'fallback');  // no window -> fallback
global.window = { CJ_I18N: { 'x.y': 'traducido' } };
assert.strictEqual(cj.t('x.y', 'fb'), 'traducido');            // hit
assert.strictEqual(cj.t('missing', 'fb'), 'fb');               // miss -> fallback
delete global.window;

// --- B3 temporal pipeline ---
// parseTimeValue
assert.strictEqual(cj.parseTimeValue('2020-01-15'), Date.UTC(2020, 0, 15));
assert.strictEqual(cj.parseTimeValue('15/01/2020'), Date.UTC(2020, 0, 15));
assert.strictEqual(cj.parseTimeValue('15-01-2020'), Date.UTC(2020, 0, 15));
assert.strictEqual(cj.parseTimeValue(1577836800000), 1577836800000);
assert.ok(typeof cj.parseTimeValue('2020-01-15T10:30:00Z') === 'number');
assert.strictEqual(cj.parseTimeValue('not a date'), null);
assert.strictEqual(cj.parseTimeValue(''), null);
assert.strictEqual(cj.parseTimeValue('2020-13-99'), null);   // invalid month/day
assert.strictEqual(cj.parseTimeValue('9'.repeat(40)), null); // over length cap

// buildTimeSeriesData: aggregates same X, drops invalid, sorts chronologically
var raw = [
  { d: '2020-03-01', v: 5 },
  { d: '2020-01-01', v: 10 },
  { d: '2020-01-01', v: 2 },
  { d: 'bad', v: 99 },
];
var series = [{ yField: 'v', label: 'V', aggregation: 'sum', color: '#000000' }];
var out = cj.buildTimeSeriesData(raw, 'd', series);
assert.strictEqual(out.labels, undefined);            // no labels for time scale
assert.strictEqual(out.datasets.length, 1);
var pts = out.datasets[0].data;
assert.strictEqual(pts.length, 2);                    // 'bad' dropped, two unique dates
assert.ok(pts[0].x < pts[1].x);                       // chronological
assert.strictEqual(pts[0].x, Date.UTC(2020, 0, 1));
assert.strictEqual(pts[0].y, 12);                     // 10 + 2 aggregated
assert.strictEqual(pts[1].y, 5);

// --- B3 a11y date formatting ---
var tsData = { datasets: [{ label: 'V', data: [{ x: Date.UTC(2020, 0, 15), y: 7 }] }] };
var mt = cj.buildAccessibleTableModel(tsData, { chartType: 'line' }, idt, true);
assert.deepStrictEqual(mt.headers, ['Series', 'X', 'Y']);
assert.strictEqual(mt.rows[0][1], '2020-01-15');   // timestamp formatted as date
assert.strictEqual(mt.rows[0][2], '7');
// without isTime, x stays raw
var mr = cj.buildAccessibleTableModel(tsData, { chartType: 'scatter' }, idt, false);
assert.strictEqual(mr.rows[0][1], String(Date.UTC(2020, 0, 15)));

// --- C3 debounce ---
(function () {
  var fakeNow = 0, nextId = 1, pending = {};
  var sched = {
    set: function (cb, d) { var id = nextId++; pending[id] = { cb: cb, due: fakeNow + d }; return id; },
    clear: function (id) { delete pending[id]; }
  };
  function tick(ms) {
    fakeNow += ms;
    for (var id in pending) {
      if (pending[id].due <= fakeNow) { var cb = pending[id].cb; delete pending[id]; cb(); }
    }
  }
  var calls = 0;
  var d = cj.makeDebounce(function () { calls++; }, 100, sched);
  d(); d(); d();
  assert.strictEqual(calls, 0);          // nothing fired yet
  tick(100);
  assert.strictEqual(calls, 1);          // three rapid calls coalesced into one
  d();
  d.cancel();
  tick(200);
  assert.strictEqual(calls, 1);          // cancel discarded the pending call
  d();
  d.flush();
  assert.strictEqual(calls, 2);          // flush ran it immediately
  tick(200);
  assert.strictEqual(calls, 2);          // and nothing extra fired
})();

// --- C3 aggregateData cache (correctness + copy-safety) ---
var arows = [
  { c: 'a', v: 1 }, { c: 'a', v: 2 }, { c: 'b', v: 10 }, { c: 'b', v: '' }
];
var r1 = cj.aggregateData(arows, 'c', 'v', 'sum');
assert.deepStrictEqual(r1.labels, ['a', 'b']);
assert.deepStrictEqual(r1.values, [3, 10]);
// mutate the returned arrays; the cache must not be corrupted
r1.labels.push('ZZZ');
r1.values[0] = 9999;
var r2 = cj.aggregateData(arows, 'c', 'v', 'sum');
assert.deepStrictEqual(r2.labels, ['a', 'b']);   // unaffected by the mutation above
assert.deepStrictEqual(r2.values, [3, 10]);
// different method is a distinct cache entry
var r3 = cj.aggregateData(arows, 'c', 'v', 'count');
assert.deepStrictEqual(r3.values, [2, 1]);        // 'b' has one numeric value

console.log('JS unit tests passed');
