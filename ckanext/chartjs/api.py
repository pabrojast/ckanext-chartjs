# encoding: utf-8
"""
Flask blueprint for Chart.js API endpoints.
Serves CSV resource data as JSON for the frontend.
"""
import csv
import io
import os
import json

from flask import Blueprint, jsonify, request, g
import ckan.plugins.toolkit as toolkit

chartjs_api = Blueprint(
    'chartjs',
    __name__,
)


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
            return resp.read().decode('utf-8', errors='replace')
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
                    with open(upload_path, 'r', encoding='utf-8', errors='replace') as f:
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

        return _parse_csv_content(content, max_rows)

    except Exception as e:
        if os.getenv("CJ_DEBUG", "false").lower() == "true":
            print(f"[chartjs] CSV download error: {e}")
        return None, None, None


def _parse_csv_content(content, max_rows):
    """Parse CSV content string into records and field metadata."""
    reader = csv.DictReader(io.StringIO(content))

    if not reader.fieldnames:
        return [], [], 0

    records = []
    for i, row in enumerate(reader):
        if i >= max_rows:
            break
        clean_row = {}
        for k, v in row.items():
            if v is None:
                clean_row[k] = ''
            else:
                # Try to convert numeric values
                try:
                    if '.' in v:
                        clean_row[k] = float(v)
                    else:
                        clean_row[k] = int(v)
                except (ValueError, TypeError):
                    clean_row[k] = v
        records.append(clean_row)

    total = len(records)

    # Infer field types from first N rows
    sample_size = min(100, total)
    fields = []
    for col_name in reader.fieldnames:
        if not col_name or not col_name.strip():
            continue
        col_name = col_name.strip()
        semantic_type = _infer_semantic_type_from_sample(
            [r.get(col_name) for r in records[:sample_size]]
        )
        analytic_type = 'measure' if semantic_type == 'quantitative' else 'dimension'
        fields.append({
            'fid': col_name,
            'name': col_name,
            'semanticType': semantic_type,
            'analyticType': analytic_type,
        })

    return records, fields, total


def _infer_semantic_type_from_sample(values):
    """Infer semantic type from a sample of values."""
    import re
    date_patterns = [
        re.compile(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}'),
        re.compile(r'^\d{1,2}[-/]\d{1,2}[-/]\d{4}'),
    ]

    numeric_count = 0
    date_count = 0
    total = 0

    for v in values:
        if v is None or v == '':
            continue
        total += 1
        if isinstance(v, (int, float)):
            numeric_count += 1
            continue
        s = str(v).strip()
        if s == '':
            continue
        try:
            float(s)
            numeric_count += 1
            continue
        except (ValueError, TypeError):
            pass
        for pat in date_patterns:
            if pat.match(s):
                date_count += 1
                break

    if total == 0:
        return 'nominal'

    if numeric_count / total > 0.8:
        return 'quantitative'
    if date_count / total > 0.8:
        return 'temporal'
    return 'nominal'


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
        return jsonify({
            'success': True,
            'source': 'datastore',
            'data': records,
            'fields': fields,
            'total': total,
            'max_rows': max_rows,
        })

    # Fall back to direct CSV (forwards session cookie for private resources)
    records, fields, total = _try_direct_csv(resource_id, max_rows)

    if records is not None:
        return jsonify({
            'success': True,
            'source': 'csv',
            'data': records,
            'fields': fields,
            'total': total,
            'max_rows': max_rows,
        })

    return jsonify({
        'success': False,
        'error': 'Could not load data from this resource. Ensure it is a valid CSV file.',
    }), 404


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

        # Validate it's valid JSON
        try:
            json.loads(config)
        except (json.JSONDecodeError, TypeError):
            return jsonify({'success': False, 'error': 'Config must be valid JSON.'}), 400

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
            return jsonify({'success': False, 'error': f'Failed to save: {str(e)}'}), 500

        return jsonify({
            'success': True,
            'message': 'Chart configuration saved successfully.',
            'view_id': view_id,
        })

    except Exception as e:
        if os.getenv("CJ_DEBUG", "false").lower() == "true":
            print(f"[chartjs] Save error: {e}")
        return jsonify({'success': False, 'error': f'Server error: {str(e)}'}), 500
