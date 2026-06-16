# encoding: utf-8
"""Pure data utilities for ckanext-chartjs.

CSV decoding / delimiter sniffing / column-wise type inference + coercion, and
filter parsing/application. Intentionally free of ckan/flask imports so the
logic can be unit-tested in isolation (see tests/test_datautils.py). api.py
imports from here.
"""
import csv
import io
import re

_MAX_FILTER_LEN = 4000
_MAX_FILTER_SEGMENTS = 100


# ------------------------------------------------------------------ encoding
def decode_bytes(raw):
    """Decode CSV bytes trying utf-8-sig (strips BOM), utf-8, then latin-1.

    latin-1 maps every byte, so this never raises. A str passes through.
    """
    if isinstance(raw, str):
        return raw
    if not isinstance(raw, (bytes, bytearray)):
        return ''
    for enc in ('utf-8-sig', 'utf-8'):
        try:
            return bytes(raw).decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return bytes(raw).decode('latin-1', errors='replace')


# ----------------------------------------------------------------- delimiter
_CANDIDATE_DELIMS = [',', ';', '\t', '|']


def sniff_delimiter(text, default=','):
    """Detect the CSV delimiter from a sample.

    Tries csv.Sniffer; on failure falls back to whichever candidate yields the
    most columns on the header line.
    """
    if not text:
        return default
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=''.join(_CANDIDATE_DELIMS))
        if dialect.delimiter in _CANDIDATE_DELIMS:
            return dialect.delimiter
    except csv.Error:
        pass
    lines = sample.splitlines()
    header = lines[0] if lines else ''
    best, best_count = default, 0
    for d in _CANDIDATE_DELIMS:
        count = len(header.split(d))
        if count > best_count:
            best, best_count = d, count
    return best


# --------------------------------------------------------- type inference
_DATE_PATTERNS = [
    re.compile(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}'),
    re.compile(r'^\d{1,2}[-/]\d{1,2}[-/]\d{4}'),
]
# Leading-zero tokens (00123, 0123) are identifiers/codes, not real numbers.
_LEADING_ZERO = re.compile(r'^0\d+$')


def _looks_numeric(s):
    try:
        float(s)
        return True
    except (ValueError, TypeError):
        return False


def infer_column_type(values):
    """Infer 'quantitative' | 'temporal' | 'nominal' from a sample of raw
    string values. A column with any leading-zero code stays nominal so codes
    like '00123' are never mangled into numbers.
    """
    numeric = 0
    date = 0
    total = 0
    has_leading_zero = False
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if s == '':
            continue
        total += 1
        if _LEADING_ZERO.match(s):
            has_leading_zero = True
        if _looks_numeric(s):
            numeric += 1
            continue
        for pat in _DATE_PATTERNS:
            if pat.match(s):
                date += 1
                break
    if total == 0:
        return 'nominal'
    if has_leading_zero:
        return 'nominal'
    if numeric / total > 0.8:
        return 'quantitative'
    if date / total > 0.8:
        return 'temporal'
    return 'nominal'


def coerce_value(raw, semantic_type):
    """Convert a raw cell to a number only for quantitative columns, and never
    for leading-zero codes. Everything else stays the original string.
    """
    if raw is None:
        return ''
    s = raw if isinstance(raw, str) else str(raw)
    if semantic_type != 'quantitative':
        return s
    t = s.strip()
    if t == '' or _LEADING_ZERO.match(t):
        return s
    try:
        if '.' in t or 'e' in t or 'E' in t:
            return float(t)
        return int(t)
    except (ValueError, TypeError):
        return s


def parse_csv(content, max_rows):
    """Parse CSV bytes/str into (records, fields, total).

    Robust to delimiter (, ; tab |) and encoding (utf-8-sig/utf-8/latin-1).
    Type inference is column-wise (preserving leading-zero IDs). `fields`
    items: {fid, name, semanticType, analyticType}.
    """
    if isinstance(content, (bytes, bytearray)):
        content = decode_bytes(content)
    if not content:
        return [], [], 0

    delim = sniff_delimiter(content)
    reader = csv.DictReader(io.StringIO(content), delimiter=delim)
    fieldnames = [c.strip() for c in (reader.fieldnames or []) if c and c.strip()]
    if not fieldnames:
        return [], [], 0

    raw_rows = []
    for i, row in enumerate(reader):
        if i >= max_rows:
            break
        raw_rows.append(row)

    sample_size = min(100, len(raw_rows))
    types = {}
    for col in fieldnames:
        sample = [raw_rows[r].get(col) for r in range(sample_size)]
        types[col] = infer_column_type(sample)

    fields = []
    for col in fieldnames:
        st = types[col]
        fields.append({
            'fid': col,
            'name': col,
            'semanticType': st,
            'analyticType': 'measure' if st == 'quantitative' else 'dimension',
        })

    records = []
    for row in raw_rows:
        clean = {}
        for col in fieldnames:
            clean[col] = coerce_value(row.get(col), types[col])
        records.append(clean)

    return records, fields, len(records)


# ------------------------------------------------------------------- filters
def parse_filters(filter_string):
    """Parse a CKAN-style filter string 'field:value|field2:value2' into
    {field: [values]}.

    Splits each clause on the FIRST ':' only, so a ':' inside a value is kept
    (e.g. 'ts:12:30' -> {'ts': ['12:30']}). Repeated fields accumulate into a
    list (OR semantics downstream). Empty/malformed clauses are ignored.

    Limitation: a literal '|' inside a value is NOT representable in this
    format (it splits the clause); callers needing that must encode differently.
    Bounded in length and segment count to avoid DoS on hostile input.
    """
    filters = {}
    if not filter_string or not isinstance(filter_string, str):
        return filters
    if len(filter_string) > _MAX_FILTER_LEN:
        filter_string = filter_string[:_MAX_FILTER_LEN]
    for segment in filter_string.split('|')[:_MAX_FILTER_SEGMENTS]:
        if ':' not in segment:
            continue
        field, value = segment.split(':', 1)
        field = field.strip()
        if not field:
            continue
        filters.setdefault(field, []).append(value)
    return filters


def apply_filters(records, filters, allowed_fields):
    """Return the records matching ALL filtered fields (AND across fields, OR
    within a single field's values).

    Security/semantics:
    - Fields not in allowed_fields are ignored (no effect), so unknown or
      hostile field names like '__class__' or ';DROP' can never filter or
      reach any dynamic operation.
    - Comparison is EXACT string equality (no regex/wildcards): '.*' matches
      only the literal '.*'.
    - Cells are stringified (None -> ''); the input list is never mutated.
    """
    if not filters or not records:
        return records
    allowed = set(str(f) for f in (allowed_fields or []))
    active = {}
    for field, values in filters.items():
        if field in allowed and values:
            active[field] = set(str(v) for v in values)
    if not active:
        return records
    out = []
    for rec in records:
        match = True
        for field, allowed_values in active.items():
            cell = rec.get(field)
            cell_str = '' if cell is None else str(cell)
            if cell_str not in allowed_values:
                match = False
                break
        if match:
            out.append(rec)
    return out
