# encoding: utf-8
"""
Flask blueprint for Chart.js API endpoints.
Serves CSV resource data as JSON for the frontend.
"""
import os
import json
import logging

from flask import Blueprint, jsonify, request, g
import ckan.plugins.toolkit as toolkit

from . import datautils

chartjs_api = Blueprint(
    'chartjs',
    __name__,
)

log = logging.getLogger(__name__)

# Whitelists + bounds for chart_config validation (see _validate_chart_config).
_ALLOWED_CHART_TYPES = {'bar', 'line', 'pie', 'doughnut', 'scatter', 'radar', 'polarArea'}
_ALLOWED_AGG = {'sum', 'count', 'average', 'min', 'max'}
_ALLOWED_SORT = {'none', 'value_desc', 'value_asc', 'label_asc', 'label_desc'}
_MAX_CONFIG_BYTES = 65536
_MAX_TEXT = 255
_MAX_SHORT = 100
_MAX_TINY = 32
_MAX_SERIES = 50


def _get_max_rows():
    """Get configured max rows limit."""
    try:
        return int(toolkit.config.get('ckanext.chartjs.max_rows', '50000'))
    except (ValueError, TypeError):
        return 50000


def _get_request_user():
    """Resolve the logged-in user from the current request context."""
    user = ''
    try:
        user = toolkit.c.user or ''
    except Exception:
        user = getattr(g, 'user', '') if hasattr(g, 'user') else ''
    return user or ''


def _try_datastore(resource_id, max_rows, user):
    """Try to fetch data from CKAN DataStore API as the given user."""
    try:
        context = {'user': user, 'ignore_auth': False}
        result = toolkit.get_action('datastore_search')(context, {
            'resource_id': resource_id,
            'limit': max_rows,
        })

        records = result.get('records', [])
        fields_info = result.get('fields', [])

        # Filter out internal _id field
        fields = []
        for f in fields_info:
            if f['id'].startswith('_'):
                continue
            fields.append({
                'fid': f['id'],
                'name': f['id'],
                'semanticType': _infer_semantic_type_from_datastore(f.get('type', 'text')),
                'analyticType': _infer_analytic_type_from_datastore(f.get('type', 'text')),
            })

        # Clean records (remove _id)
        clean_records = []
        for rec in records:
            clean_rec = {k: v for k, v in rec.items() if not k.startswith('_')}
            clean_records.append(clean_rec)

        return clean_records, fields, result.get('total', len(records))

    except Exception:
        return None, None, None


def _infer_semantic_type_from_datastore(ds_type):
    """Map DataStore types to semantic types."""
    ds_type = ds_type.lower()
    if ds_type in ('int', 'int4', 'int8', 'float', 'float4', 'float8',
                    'numeric', 'number', 'integer', 'bigint', 'smallint',
                    'double precision', 'real'):
        return 'quantitative'
    if ds_type in ('date', 'timestamp', 'timestamptz', 'time', 'timetz'):
        return 'temporal'
    return 'nominal'


def _infer_analytic_type_from_datastore(ds_type):
    """Map DataStore types to analytic types."""
    ds_type = ds_type.lower()
    if ds_type in ('int', 'int4', 'int8', 'float', 'float4', 'float8',
                    'numeric', 'number', 'integer', 'bigint', 'smallint',
                    'double precision', 'real'):
        return 'measure'
    return 'dimension'


def _http_fetch(url, headers=None, timeout=60):
    """Fetch a URL with optional headers, returning decoded text or None."""
    import urllib.request
    try:
        req = urllib.request.Request(url)
        for k, v in (headers or {}).items():
            if v:
                req.add_header(k, v)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as e:
        if os.getenv("CJ_DEBUG", "false").lower() == "true":
            print(f"[chartjs] HTTP fetch failed for {url}: {e}")
        return None


def _try_direct_csv(resource_id, max_rows):
    """Fall back to downloading the CSV file directly.

    For private resources stored in cloudstorage, the CKAN download endpoint
    requires the user's session. We forward the cookie from the current
    request so the downstream auth check sees the same user that already
    passed the resource view's auth gate.
    """
    try:
        import ckan.model as model
        resource = model.Resource.get(resource_id)
        if not resource:
            return None, None, None

        resource_url = resource.url
        if not resource_url:
            return None, None, None

        content = None

        # 1. Local upload (filesystem-backed CKAN uploads).
        try:
            from ckan.lib.uploader import get_resource_uploader
            uploader = get_resource_uploader(resource.as_dict())
            if hasattr(uploader, 'get_path'):
                upload_path = uploader.get_path(resource.id)
                if upload_path and isinstance(upload_path, str) and os.path.exists(upload_path):
                    with open(upload_path, 'rb') as f:
                        content = f.read()
        except Exception:
            pass

        # 2. cloudstorage signed URL (works without forwarding auth).
        if content is None and resource.url_type == 'upload':
            try:
                from ckanext.cloudstorage.storage import ResourceCloudStorage
                cs_uploader = ResourceCloudStorage(resource.as_dict())
                signed_url = cs_uploader.get_url_from_filename(
                    resource.id, resource.url
                )
                if signed_url:
                    content = _http_fetch(signed_url, timeout=60)
            except ImportError:
                pass
            except Exception:
                pass

        # 3. CKAN's own download endpoint, with the caller's session cookie
        #    so private resources resolve correctly. CKAN returns the file
        #    or a redirect to a signed storage URL.
        if content is None and resource.url_type == 'upload':
            site_url = toolkit.config.get('ckan.site_url', '').rstrip('/')
            if not site_url:
                site_url = 'http://localhost:5000'
            download_url = '{}/dataset/{}/resource/{}/download/{}'.format(
                site_url, resource.package_id, resource.id, resource.url
            )
            headers = {
                'Cookie': request.headers.get('Cookie', ''),
                'Authorization': request.headers.get('Authorization', ''),
            }
            content = _http_fetch(download_url, headers=headers, timeout=60)

        # 4. External URL (link-type resources).
        if content is None and resource_url.startswith(('http://', 'https://')):
            content = _http_fetch(resource_url, timeout=30)

        if content is None:
            return None, None, None

        return datautils.parse_csv(content, max_rows)

    except Exception as e:
        if os.getenv("CJ_DEBUG", "false").lower() == "true":
            print(f"[chartjs] CSV download error: {e}")
        return None, None, None


@chartjs_api.route('/api/chartjs/data/<resource_id>', methods=['GET'])
def get_resource_data(resource_id):
    """
    Serve resource data as JSON for Chart.js frontend.
    Tries DataStore API first, falls back to direct CSV download.
    Authorizes the request as the logged-in user so private resources
    are gated by CKAN's normal auth model.
    """
    max_rows = _get_max_rows()
    user = _get_request_user()

    filter_string = request.args.get('filters', '')

    def _apply_filters(records, fields):
        """Apply URL filters post-load against the field whitelist. Never
        raises out: a malformed filter degrades to 'no filtering'."""
        if not filter_string:
            return records
        try:
            parsed = datautils.parse_filters(filter_string)
            if parsed:
                allowed = [f['fid'] for f in fields]
                return datautils.apply_filters(records, parsed, allowed)
        except Exception:
            if _is_cj_debug():
                log.warning('[chartjs] filter apply failed for resource %s', resource_id)
        return records

    # Gate access through resource_show: matches what CKAN would do for
    # a logged-in user viewing the resource page. Returns 403 for users
    # who don't have access, 404 for unknown ids.
    auth_context = {'user': user, 'ignore_auth': False}
    try:
        toolkit.get_action('resource_show')(auth_context, {'id': resource_id})
    except toolkit.ObjectNotFound:
        return jsonify({'success': False, 'error': 'Resource not found.'}), 404
    except toolkit.NotAuthorized:
        return jsonify({
            'success': False,
            'error': 'Not authorized to view this resource. Please log in.',
        }), 403

    # Try DataStore first as the authenticated user
    records, fields, total = _try_datastore(resource_id, max_rows, user)

    if records is not None:
        records = _apply_filters(records, fields)
        return jsonify({
            'success': True,
            'source': 'datastore',
            'data': records,
            'fields': fields,
            'total': len(records),
            'max_rows': max_rows,
        })

    # Fall back to direct CSV (forwards session cookie for private resources)
    records, fields, total = _try_direct_csv(resource_id, max_rows)

    if records is not None:
        records = _apply_filters(records, fields)
        return jsonify({
            'success': True,
            'source': 'csv',
            'data': records,
            'fields': fields,
            'total': len(records),
            'max_rows': max_rows,
        })

    return jsonify({
        'success': False,
        'error': 'Could not load data from this resource. Ensure it is a valid CSV file.',
    }), 404


def _is_cj_debug():
    return os.getenv('CJ_DEBUG', 'false').lower() == 'true'


def _clean_string(value, max_len=_MAX_TEXT):
    """Return value as a length-capped string ('' if not a string).

    Python str slicing is by code point, so this never splits a character.
    We intentionally do NOT strip characters like & or quotes: titles/labels
    legitimately contain them, and the values are rendered on the Chart.js
    canvas (not as HTML), so input mangling would corrupt data without
    removing a real sink.
    """
    if not isinstance(value, str):
        return ''
    return value[:max_len]


def _coerce_bool(value, default=False):
    """Robust boolean coercion. Note bool('false') is True, so we must not
    rely on bool() for string inputs."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        v = value.strip().lower()
        if v in ('true', '1', 'yes', 'on'):
            return True
        if v in ('false', '0', 'no', 'off', ''):
            return False
    return default


def _clamp_int(value, default, min_value, max_value):
    try:
        n = int(value)
    except (ValueError, TypeError):
        return default
    if n < min_value:
        return min_value
    if n > max_value:
        return max_value
    return n


def _validate_chart_config(config_str):
    """Validate + normalize a chart_config JSON string against a strict whitelist.

    Returns a cleaned, re-serialized JSON string containing only known fields
    with bounded types/sizes. Raises ValueError (with safe, generic messages)
    on structurally invalid input. This prevents persisting arbitrary or
    oversized payloads through the save endpoint.
    """
    if not isinstance(config_str, str):
        raise ValueError('Config must be a JSON string.')
    if len(config_str.encode('utf-8')) > _MAX_CONFIG_BYTES:
        raise ValueError('Config is too large.')
    try:
        cfg = json.loads(config_str)
    except (json.JSONDecodeError, TypeError):
        raise ValueError('Config must be valid JSON.')
    if not isinstance(cfg, dict):
        raise ValueError('Config must be a JSON object.')

    chart_type = cfg.get('chartType')
    if chart_type not in _ALLOWED_CHART_TYPES:
        raise ValueError('Unknown chart type.')

    clean = {
        'version': _clamp_int(cfg.get('version', 1), 1, 1, 99),
        'chartType': chart_type,
        'title': _clean_string(cfg.get('title', '')),
        'xAxis': _clean_string(cfg.get('xAxis', '')),
    }

    clean_series = []
    series_in = cfg.get('series')
    if isinstance(series_in, list):
        for s in series_in[:_MAX_SERIES]:
            if not isinstance(s, dict):
                continue
            agg = s.get('aggregation')
            clean_series.append({
                'yField': _clean_string(s.get('yField', '')),
                'label': _clean_string(s.get('label', '')),
                'aggregation': agg if agg in _ALLOWED_AGG else 'sum',
                'color': _clean_string(s.get('color', ''), _MAX_TINY),
            })
    clean['series'] = clean_series

    opts_in = cfg.get('options')
    opts = opts_in if isinstance(opts_in, dict) else {}
    sort_mode = opts.get('categorySort')
    nf_in = opts.get('numberFormat')
    nf = nf_in if isinstance(nf_in, dict) else {}
    clean['options'] = {
        'showLegend': _coerce_bool(opts.get('showLegend'), True),
        'showGrid': _coerce_bool(opts.get('showGrid'), True),
        'stacked': _coerce_bool(opts.get('stacked'), False),
        'beginAtZero': _coerce_bool(opts.get('beginAtZero'), True),
        'showOthers': _coerce_bool(opts.get('showOthers'), False),
        'horizontalBars': _coerce_bool(opts.get('horizontalBars'), False),
        'categorySort': sort_mode if sort_mode in _ALLOWED_SORT else 'none',
        'topN': _clamp_int(opts.get('topN', 0), 0, 0, 100),
        'othersLabel': _clean_string(opts.get('othersLabel', 'Others'), _MAX_SHORT) or 'Others',
        'xAxisTitle': _clean_string(opts.get('xAxisTitle', ''), _MAX_SHORT),
        'yAxisTitle': _clean_string(opts.get('yAxisTitle', ''), _MAX_SHORT),
        'numberFormat': {
            'decimalsMode': 'fixed' if nf.get('decimalsMode') == 'fixed' else 'auto',
            'decimals': _clamp_int(nf.get('decimals', 2), 2, 0, 6),
            'useThousands': _coerce_bool(nf.get('useThousands'), True),
            'prefix': _clean_string(nf.get('prefix', ''), 16),
            'suffix': _clean_string(nf.get('suffix', ''), 16),
        },
    }

    return json.dumps(clean)


@chartjs_api.route('/api/chartjs/view/<view_id>/save-config', methods=['POST'])
def save_view_config(view_id):
    """
    Save chart configuration to a resource view's config.
    Expects JSON body: {"config": "...json string..."}
    """
    try:
        user = _get_request_user() or None

        if not user:
            return jsonify({'success': False, 'error': 'Authentication required. Please log in.'}), 401

        data = request.get_json(silent=True)
        if not data or 'config' not in data:
            return jsonify({'success': False, 'error': 'Missing "config" field in request body.'}), 400

        config = data['config']
        if not isinstance(config, str):
            try:
                config = json.dumps(config)
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': 'Invalid config format.'}), 400

        # Validate + normalize against a strict whitelist; persist the cleaned
        # JSON, never the raw client payload.
        try:
            config = _validate_chart_config(config)
        except ValueError as ve:
            return jsonify({'success': False, 'error': str(ve)}), 400

        context = {'user': user, 'ignore_auth': False}

        try:
            current_view = toolkit.get_action('resource_view_show')(context, {'id': view_id})
        except toolkit.ObjectNotFound:
            return jsonify({'success': False, 'error': f'View not found: {view_id}'}), 404
        except toolkit.NotAuthorized:
            return jsonify({'success': False, 'error': 'Not authorized to access this view.'}), 403

        update_data = {
            'id': view_id,
            'resource_id': current_view.get('resource_id'),
            'view_type': current_view.get('view_type'),
            'title': current_view.get('title'),
            'description': current_view.get('description', ''),
            'chart_config': config,
        }

        try:
            toolkit.get_action('resource_view_update')(context, update_data)
        except toolkit.NotAuthorized:
            return jsonify({'success': False, 'error': 'Not authorized to update this view.'}), 403
        except Exception as e:
            if _is_cj_debug():
                log.warning('[chartjs] resource_view_update failed for view %s: %s', view_id, e)
            return jsonify({'success': False, 'error': 'Failed to save chart configuration.'}), 500

        return jsonify({
            'success': True,
            'message': 'Chart configuration saved successfully.',
            'view_id': view_id,
        })

    except Exception as e:
        if _is_cj_debug():
            log.warning('[chartjs] Save error for view %s: %s', view_id, e)
        return jsonify({'success': False, 'error': 'Internal server error.'}), 500
