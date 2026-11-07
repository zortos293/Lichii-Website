#!/usr/bin/env python3
import argparse
import json
import shutil
from pathlib import Path

from discover import ROOT, norm, save


def main():
    parser = argparse.ArgumentParser(description='Carry the published catalogue forward into this snapshot.')
    parser.add_argument('website', type=Path, help='Website checkout containing data/ and public/art/')
    website = parser.parse_args().website.resolve()
    previous = json.loads((website / 'data/catalog.json').read_text())
    evidence = {str(p['sgdbId']): p for p in json.loads((website / 'data/provenance.json').read_text())}
    published_at = json.loads((website / 'data/coverage.json').read_text())['exportedAt']
    fresh = {g['sgdbId']: g for g in json.loads((ROOT / 'catalog.json').read_text())}
    membership = json.loads((ROOT / 'membership.json').read_text())
    unresolved = json.loads((ROOT / 'unmatched-nintendo.json').read_text())
    coverage = json.loads((ROOT / 'coverage.json').read_text())

    claimed = {m['nintendoId']: g for g, p in evidence.items() for m in p['nintendoMembership']}
    moved = [(m['nintendoId'], claimed[m['nintendoId']], gid) for gid, members in membership.items()
             for m in members if claimed.get(m['nintendoId'], gid) != gid]
    assert not moved, f'Nintendo records now match a different SGDB ID; review before publishing: {moved}'

    catalog, retained, renamed = [], [], []
    for old in previous:
        gid = str(old['sgdbId'])
        if old['sgdbId'] not in fresh:
            catalog.append(old)
            membership[gid] = [dict(m, retainedFromSnapshot=published_at) for m in evidence[gid]['nintendoMembership']]
            retained.append({'sgdbId': old['sgdbId'], 'title': old['title'],
                             'nintendoIds': [m['nintendoId'] for m in membership[gid]]})
            continue
        current = fresh.pop(old['sgdbId'])
        catalog.append(dict(current, slug=old['slug'], title=old['title']))
        if current['title'] != old['title']:
            renamed.append({'sgdbId': old['sgdbId'], 'published': old['title'], 'nintendo': current['title']})
    added = sorted(fresh.values(), key=lambda g: (norm(g['title']), g['sgdbId']))
    catalog += added

    held = {n for r in retained for n in r['nintendoIds']}
    unresolved = [row for row in unresolved if row['nintendo']['fs_id'] not in held]

    art = ROOT / 'art'
    art.mkdir(exist_ok=True)
    provenance_path = ROOT / 'artwork-provenance.json'
    provenance = json.loads(provenance_path.read_text()) if provenance_path.exists() else {}
    for old in previous:
        gid = str(old['sgdbId'])
        roles = evidence[gid]['artwork']
        if not roles:
            continue
        provenance[gid] = {'sgdbId': old['sgdbId'], 'errors': [], 'seededFromPublishedExport': published_at,
                           **{role: dict(roles[role], author={'name': roles[role]['author']}) if role in roles else None
                              for role in ['cover', 'hero']}}
        for asset in roles.values():
            target = art / Path(asset['path']).name
            if not target.exists():
                shutil.copy2(website / 'public' / asset['path'].lstrip('/'), target)

    published = {g['sgdbId']: g['slug'] for g in previous}
    assert all(published[g['sgdbId']] == g['slug'] for g in catalog if g['sgdbId'] in published)
    assert len(published.keys() & {g['sgdbId'] for g in catalog}) == len(previous)
    assert len({g['sgdbId'] for g in catalog}) == len({g['slug'] for g in catalog}) == len(catalog)

    catalog.sort(key=lambda g: (norm(g['title']), g['sgdbId']))
    coverage.update({'uniqueSgdbGames': len(catalog), 'unmatchedNintendoRecords': len(unresolved),
                     'previouslyPublishedGames': len(previous), 'previousSnapshotExportedAt': published_at,
                     'newGames': len(added), 'retainedWithoutCurrentMatch': len(retained)})
    save('catalog.json', catalog)
    save('membership.json', membership)
    save('unmatched-nintendo.json', unresolved)
    save('coverage.json', coverage)
    save('artwork-provenance.json', provenance)
    save('merge-report.json', {'previousSnapshotExportedAt': published_at, 'previouslyPublished': len(previous),
                               'added': [{'sgdbId': g['sgdbId'], 'title': g['title']} for g in added],
                               'retainedWithoutCurrentMatch': retained, 'publishedTitleKept': renamed})
    print(f'MERGE {len(previous)} published + {len(added)} new = {len(catalog)}; '
          f'{len(retained)} retained without a current match; {len(unresolved)} unresolved', flush=True)


if __name__ == '__main__':
    main()
