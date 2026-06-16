# encoding: utf-8
"""Unit tests for the pure data utilities (no ckan/flask needed)."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from ckanext.chartjs import datautils as du


def test_decode_utf8_and_bom():
    assert du.decode_bytes('plain'.encode('utf-8')) == 'plain'
    # b'\xef\xbb\xbf' is the UTF-8 BOM; utf-8-sig decoding must strip it.
    assert du.decode_bytes(b'\xef\xbb\xbf' + 'hdr'.encode('utf-8')) == 'hdr'


def test_decode_latin1_fallback():
    # 'café' in latin-1 is not valid utf-8; must not raise and must round-trip.
    raw = 'café'.encode('latin-1')
    out = du.decode_bytes(raw)
    assert 'caf' in out


def test_sniff_delimiter():
    assert du.sniff_delimiter('a,b,c\n1,2,3') == ','
    assert du.sniff_delimiter('a;b;c\n1;2;3') == ';'
    assert du.sniff_delimiter('a\tb\tc\n1\t2\t3') == '\t'


def test_infer_column_type():
    assert du.infer_column_type(['1', '2', '3']) == 'quantitative'
    assert du.infer_column_type(['2020-01-01', '2021-12-31']) == 'temporal'
    assert du.infer_column_type(['red', 'green', 'blue']) == 'nominal'
    # leading-zero codes stay nominal even though they "look numeric"
    assert du.infer_column_type(['00123', '00456', '00789']) == 'nominal'


def test_coerce_value():
    assert du.coerce_value('123', 'quantitative') == 123
    assert du.coerce_value('1.5', 'quantitative') == 1.5
    assert du.coerce_value('00123', 'quantitative') == '00123'  # ID preserved
    assert du.coerce_value('abc', 'quantitative') == 'abc'
    assert du.coerce_value('123', 'nominal') == '123'  # nominal stays string


def test_parse_csv_semicolon_and_ids():
    content = 'code;city;sales\n00123;Lima;100\n00456;Quito;200\n'
    records, fields, total = du.parse_csv(content, 1000)
    assert total == 2
    by_fid = {f['fid']: f for f in fields}
    assert by_fid['code']['semanticType'] == 'nominal'      # leading-zero IDs
    assert by_fid['sales']['semanticType'] == 'quantitative'
    assert records[0]['code'] == '00123'                    # not 123
    assert records[0]['sales'] == 100                       # coerced to int


def test_parse_csv_bytes_latin1():
    content = 'name;qty\nMantención;5\n'.encode('latin-1')
    records, fields, total = du.parse_csv(content, 1000)
    assert total == 1
    assert records[0]['qty'] == 5


def test_parse_csv_empty():
    assert du.parse_csv('', 10) == ([], [], 0)
    assert du.parse_csv(b'', 10) == ([], [], 0)


def test_parse_csv_respects_max_rows():
    content = 'n\n' + '\n'.join(str(i) for i in range(50)) + '\n'
    records, fields, total = du.parse_csv(content, 10)
    assert total == 10


def test_parse_filters_basic():
    assert du.parse_filters('') == {}
    assert du.parse_filters(None) == {}
    assert du.parse_filters('region:Lima') == {'region': ['Lima']}
    assert du.parse_filters('region:Lima|year:2020') == {'region': ['Lima'], 'year': ['2020']}


def test_parse_filters_multivalue_and_first_colon():
    assert du.parse_filters('city:Lima|city:Quito') == {'city': ['Lima', 'Quito']}
    # split on first ':' only -> a time-like value is preserved
    assert du.parse_filters('ts:12:30') == {'ts': ['12:30']}


def test_parse_filters_malformed_ignored():
    assert du.parse_filters('noColonHere') == {}
    assert du.parse_filters(':novalue') == {}  # empty field name ignored


def test_parse_filters_bounded_segments():
    big = '|'.join('f%d:v' % i for i in range(500))
    assert len(du.parse_filters(big)) <= 100


def test_apply_filters_equality_and_whitelist():
    recs = [{'city': 'Lima', 'n': 1}, {'city': 'Quito', 'n': 2}, {'city': 'Lima', 'n': 3}]
    out = du.apply_filters(recs, {'city': ['Lima']}, ['city', 'n'])
    assert [r['n'] for r in out] == [1, 3]


def test_apply_filters_or_within_field():
    recs = [{'c': 'a'}, {'c': 'b'}, {'c': 'c'}]
    out = du.apply_filters(recs, {'c': ['a', 'c']}, ['c'])
    assert [r['c'] for r in out] == ['a', 'c']


def test_apply_filters_and_across_fields_with_coerced_number():
    recs = [{'c': 'a', 'n': 1}, {'c': 'a', 'n': 2}]
    # n is a coerced int; filter value '2' compares as string
    out = du.apply_filters(recs, {'c': ['a'], 'n': ['2']}, ['c', 'n'])
    assert len(out) == 1 and out[0]['n'] == 2


def test_apply_filters_unknown_and_injection_fields_ignored():
    recs = [{'c': 'a'}, {'c': 'b'}]
    assert du.apply_filters(recs, {'__class__': ['x']}, ['c']) == recs
    assert du.apply_filters(recs, {';DROP TABLE users': ['1']}, ['c']) == recs


def test_apply_filters_literal_not_regex():
    recs = [{'c': 'abc'}, {'c': 'x'}]
    assert du.apply_filters(recs, {'c': ['.*']}, ['c']) == []  # '.*' is literal


def test_apply_filters_does_not_mutate_input():
    recs = [{'c': 'a'}, {'c': 'b'}]
    snapshot = [dict(r) for r in recs]
    du.apply_filters(recs, {'c': ['a']}, ['c'])
    assert recs == snapshot


def test_apply_filters_all_outside_whitelist_returns_all():
    recs = [{'c': 'a'}, {'c': 'b'}]
    assert du.apply_filters(recs, {'zzz': ['1']}, ['c']) == recs
