#!/usr/bin/env python3
import argparse
import concurrent.futures
import hashlib
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / 'raw'
RAW.mkdir(exist_ok=True)
SGDB = 'https://www.steamgriddb.com'
NINTENDO = 'https://search.nintendo-europe.com/en/select'
NOA = 'https://U3B6GR4UA3-dsn.algolia.net/1/indexes/store_game_en_us/query?' + urllib.parse.urlencode(
    {'x-algolia-application-id': 'U3B6GR4UA3', 'x-algolia-api-key': 'a29c6927638bfd8cee23993e51e721c9'})
NOA_FILTER = ('corePlatforms:"Nintendo Switch 2" AND NOT editions:DLC AND NOT editions:"Upgrade pack" '
              'AND NOT dlcType:"ROM Bundle"')
NOA_FIELDS = ['title', 'url', 'nsuid', 'corePlatforms', 'releaseDate', 'releaseDateDisplay', 'softwarePublisher']


def save(path, value):
    path = ROOT / path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def fetch(url, body=None):
    key = hashlib.sha256((url + json.dumps(body, sort_keys=True)).encode()).hexdigest()
    path = RAW / (key + '.json')
    if path.exists():
        return json.loads(path.read_text())['response']
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                                         headers={'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=40) as response:
                data = json.load(response)
            save(path, {'url': url, 'body': body, 'fetchedAt': datetime.now(timezone.utc).isoformat(), 'response': data})
            time.sleep(0.15)
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def norm(title):
    title = unicodedata.normalize('NFKD', title.replace('™', '').replace('®', '').replace('©', '')).lower()
    title = title.replace('&', 'and').replace('×', 'x')
    return re.sub(r'[^a-z0-9]', '', title)


def clean(title):
    return title.replace('™', '').replace('®', '').strip()


def search(title):
    url = SGDB + '/api/public/search/autocomplete?' + urllib.parse.urlencode({'term': title})
    data = fetch(url)
    if not data.get('success'):
        raise ValueError(data)
    return data['data']


def match(doc):
    title = clean(doc['title'])
    variants = [title]
    platformless = re.sub(r'\s*[-–—:]?\s*Nintendo Switch\s*2 Edition', '', title, flags=re.I).strip()
    if platformless != title:
        variants.append(platformless)
    candidates = {}
    queries = []
    for q in variants:
        queries.append(q)
        found = search(q)
        candidates.update({x['id']: x for x in found})
        exact = [x for x in found if norm(x['name']) == norm(title)]
        if len(exact) == 1:
            return {'nintendo': doc, 'sgdb': exact[0], 'method': 'normalized_exact', 'queries': queries}
    if platformless != title:
        exact = [x for x in candidates.values() if norm(x['name']) == norm(platformless)]
        if len(exact) == 1:
            return {'nintendo': doc, 'sgdb': exact[0], 'method': 'shared_base_entry_for_verified_switch2_edition', 'queries': queries}
    return {'nintendo': doc, 'sgdb': None, 'method': 'unmatched_or_ambiguous', 'queries': queries, 'candidates': list(candidates.values())}


def discover_eu():
    docs, pages = [], []
    total = None
    for start in range(0, 100000, 100):
        params = {'q': '*', 'fq': 'type:GAME AND system_type:nintendoswitch2', 'rows': 100,
                  'start': start, 'sort': 'sorting_title asc,fs_id asc', 'wt': 'json'}
        url = NINTENDO + '?' + urllib.parse.urlencode(params)
        data = fetch(url)['response']
        if total is not None and total != data['numFound']:
            raise RuntimeError('Source changed during pagination. Refresh cache and rerun.')
        total = data['numFound']
        rows = data['docs']
        pages.append({'url': url, 'start': start, 'returned': len(rows), 'total': total})
        docs.extend(rows)
        if len(docs) >= total:
            break
        if not rows:
            raise RuntimeError('Unexpected empty source page')
    assert len(docs) == total == len({x['fs_id'] for x in docs})
    assert all('Nintendo Switch 2' in d.get('system_names_txt', []) for d in docs)
    for d in docs:
        d['source'] = 'Nintendo Europe'
    return docs, {'source': 'Nintendo Europe', 'scope': 'Nintendo Europe English index; not worldwide',
                  'query': 'type:GAME AND system_type:nintendoswitch2', 'completeForQuery': True,
                  'reportedTotal': total, 'uniqueRecords': len(docs), 'processedRecords': len(docs), 'pages': pages}


def noa_doc(hit):
    date = hit['releaseDate'][:10]
    exact = hit.get('releaseDateDisplay') is None
    return {'fs_id': 'noa-' + hit['objectID'], 'title': hit['title'].strip(), 'url': hit['url'],
            'system_names_txt': hit['corePlatforms'], 'date_from': date + 'T00:00:00Z',
            'pretty_date_s': datetime.strptime(date, '%Y-%m-%d').strftime('%d/%m/%Y') if exact else hit['releaseDateDisplay'],
            'publisher': hit.get('softwarePublisher'), 'nsuid_txt': [hit['nsuid']] if hit.get('nsuid') else [],
            'source': 'Nintendo of America'}


def discover_na(eu_docs):
    hits, pages = [], []
    total = None
    for page in range(10):
        body = {'query': '', 'filters': NOA_FILTER, 'hitsPerPage': 100, 'page': page, 'attributesToRetrieve': NOA_FIELDS}
        data = fetch(NOA, body)
        if total is not None and total != data['nbHits']:
            raise RuntimeError('Source changed during pagination. Refresh cache and rerun.')
        total = data['nbHits']
        pages.append({'url': NOA.split('?')[0], 'body': body, 'page': page, 'returned': len(data['hits']), 'total': total})
        hits.extend(data['hits'])
        if len(hits) >= total:
            break
        if not data['hits']:
            raise RuntimeError('Unexpected empty source page')
    assert total < 1000, 'Algolia only pages through the first 1000 hits; partition the query'
    assert len(hits) == total == len({h['objectID'] for h in hits})
    assert all('Nintendo Switch 2' in h['corePlatforms'] for h in hits)
    eu_titles = {norm(d['title']) for d in eu_docs}
    docs = [noa_doc(h) for h in hits]
    only = [d for d in docs if norm(d['title']) not in eu_titles]
    return only, {'source': 'Nintendo of America', 'scope': 'Nintendo of America US English store index; not worldwide',
                  'query': NOA_FILTER, 'completeForQuery': True, 'reportedTotal': total, 'uniqueRecords': len(docs),
                  'overlapWithEuropeByNormalizedTitle': len(docs) - len(only), 'processedRecords': len(only), 'pages': pages}


def discover():
    eu_docs, eu_coverage = discover_eu()
    na_docs, na_coverage = discover_na(eu_docs)
    docs = eu_docs + na_docs
    save('nintendo-source.json', docs)
    save('source-coverage.json', {'scope': 'Nintendo Europe and Nintendo of America English indexes; not worldwide',
                                  'sources': [eu_coverage, na_coverage]})
    print(f'SOURCE {len(eu_docs)} Europe records; {na_coverage["uniqueRecords"]} America records, '
          f'{len(na_docs)} not in Europe', flush=True)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(match, doc): doc for doc in docs}
        for future in concurrent.futures.as_completed(futures):
            doc = futures[future]
            try:
                result = future.result()
            except Exception as error:
                result = {'nintendo': doc, 'sgdb': None, 'method': 'request_failed', 'error': str(error)}
            results.append(result)
            if len(results) % 25 == 0:
                print(f'MATCH {len(results)}/{len(docs)} accepted={sum(bool(x["sgdb"]) for x in results)}', flush=True)
                save('matches-progress.json', results)
    results.sort(key=lambda x: (norm(x['nintendo']['title']), x['nintendo']['fs_id']))
    save('matches.json', results)
    export(results)


def export(results):
    catalog, membership, unresolved = {}, {}, []
    for row in results:
        d, game = row['nintendo'], row['sgdb']
        if game is None:
            unresolved.append(row)
            continue
        gid = game['id']
        title = clean(d['title'])
        slug = re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode().lower()).strip('-') + '-' + str(gid)
        if gid not in catalog:
            catalog[gid] = {'sgdbId': gid, 'slug': slug, 'title': title, 'coverPath': None, 'heroPath': None,
                            'artworkCredit': None, 'artworkSource': None}
        membership.setdefault(str(gid), []).append({'nintendoId': d['fs_id'], 'nintendoTitle': d['title'],
            'source': d['source'], 'sourceUrl': 'https://www.nintendo.com' + d['url'], 'platform': d.get('system_names_txt'),
            'releaseDate': d.get('date_from'), 'releaseDateDisplay': d.get('pretty_date_s'), 'publisher': d.get('publisher'),
            'sgdbTitle': game['name'], 'sgdbReleaseTimestamp': game.get('release_date'),
            'matchingMethod': row['method'], 'queries': row.get('queries', []), 'nintendoNsuids': d.get('nsuid_txt', [])})
    for gid, item in catalog.items():
        members = [m for m in membership[str(gid)] if m['source'] == 'Nintendo Europe'] or membership[str(gid)]
        specific = [m for m in members if m['platform'] == ['Nintendo Switch 2']]
        canonical = specific or members
        item['title'] = clean(canonical[0]['nintendoTitle'])
        item['slug'] = re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', item['title']).encode('ascii', 'ignore').decode().lower()).strip('-') + '-' + str(gid)
        releases = {m['releaseDate'] for m in canonical if m.get('releaseDate') and re.fullmatch(r'\d{2}/\d{2}/\d{4}', m.get('releaseDateDisplay') or '')}
        publishers = {m['publisher'] for m in canonical if m.get('publisher')}
        if len(releases) == 1:
            item['releaseDate'] = next(iter(releases))[:10]
        if len(publishers) == 1:
            item['publisher'] = next(iter(publishers))
    save('catalog.json', sorted(catalog.values(), key=lambda x: (norm(x['title']), x['sgdbId'])))
    save('membership.json', membership)
    save('unmatched-nintendo.json', unresolved)
    save('coverage.json', {'worldwideExhaustive': False, 'sgdbPlatformListingAvailable': False,
        'nintendoScope': ['Nintendo Europe English, type:GAME AND system_type:nintendoswitch2',
                          'Nintendo of America US English store, Switch 2 games excluding DLC, upgrade packs and ROM bundles; '
                          'only records whose normalized title is absent from Europe'],
        'nintendoRecordsProcessed': len(results), 'matchedNintendoRecords': sum(bool(r['sgdb']) for r in results),
        'uniqueSgdbGames': len(catalog), 'unmatchedNintendoRecords': len(unresolved),
        'reportCount': 0, 'reportsSeeded': False,
        'limitations': ['Nintendo regional index is not a worldwide catalogue.',
                       'SGDB autocomplete is ranked and not paginated; non-matches are unresolved, not proven absent.',
                       'SGDB has no Switch 2 membership field. Nintendo supplies platform evidence.',
                       'Generic SGDB release timestamps are not platform release dates; exported dates use Nintendo Europe, '
                       'or Nintendo of America for records only America lists.',
                       'Shared SGDB IDs can represent multiple Nintendo editions; membership.json preserves every source record.']})
    print(f'EXPORT {len(catalog)} SGDB games; {len(unresolved)} unresolved Nintendo records', flush=True)


if __name__ == '__main__':
    discover()
