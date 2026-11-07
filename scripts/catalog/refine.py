#!/usr/bin/env python3
import concurrent.futures
import json
import re
from datetime import datetime, timezone

from discover import ROOT, clean, export, norm, save, search

ALIASES = {
    'Cyberpunk 2077: Ultimate Edition': 'Cyberpunk 2077',
    'ELDEN RING Tarnished Edition': 'Elden Ring',
    'Star Wars Outlaws Gold Edition': 'Star Wars Outlaws',
    'Super Mario Bros. Wonder – Nintendo Switch 2 Edition + Meetup in Bellabel Park': 'Super Mario Bros. Wonder',
    '007 First Light - Deluxe Edition': '007 First Light',
    'Tales of ARISE - Beyond the Dawn Edition': 'Tales of Arise',
    'HITMAN World of Assassination – Signature Edition': 'Hitman World of Assassination',
    'GRID Legends: Deluxe Edition': 'GRID Legends',
    'Lies of P: Complete Edition': 'Lies of P',
    'Stellar Blade Complete Edition': 'Stellar Blade',
    'Resident Evil 4 Gold Edition': 'Resident Evil 4',
    'Resident Evil 2 Deluxe Edition': 'Resident Evil 2',
    'Resident Evil Village Gold Edition': 'Resident Evil Village',
    'Resident Evil 7 biohazard Gold Edition': 'Resident Evil 7: Biohazard',
    'South of Midnight Weaver\'s Edition': 'South of Midnight',
    'FATAL FURY: City of the Wolves - STANDARD Edition': 'Fatal Fury: City of the Wolves',
    # 2026-11-07 review: edition, bundle-of-one-game, platform-label, regional-name and SGDB-spelling aliases.
    'BURGGEIST for Nintendo Switch 2': 'BURGGEIST',
    'Cities: Skylines - Expanded Edition': 'Cities: Skylines',
    'CRISIS CORE –FINAL FANTASY VII– REUNION –DIGITAL DELUXE EDITION–': 'Crisis Core: Final Fantasy VII – Reunion',
    'DayZ: Cool Edition': 'DayZ',
    'Devil May Cry 5 Devil Hunter Edition': 'Devil May Cry 5',
    'Diablo IV: Age of Hatred Collection': 'Diablo IV',
    'EARTH DEFENSE FORCE5 for Nintendo Switch 2': 'EARTH DEFENSE FORCE 5',
    'EA SPORTS FC 26 ICONS Edition': 'EA SPORTS FC 26',
    'EA SPORTS FC 26 The World\'s Game Edition': 'EA SPORTS FC 26',
    'EA SPORTS FC 27 Ultimate Edition': 'EA SPORTS FC 27',
    'EA SPORTS Madden NFL 27 Deluxe Edition': 'EA SPORTS Madden NFL 27',
    'EVERSPACE 2 - Galactic Edition': 'EVERSPACE 2',
    'Fallout 4: Anniversary Edition': 'Fallout 4',
    'FANTASY LIFE i: The Girl Who Steals Time - Nintendo Switch 2 Edition Upgrade Pack': 'FANTASY LIFE i: The Girl Who Steals Time',
    'Fire Emblem: Fortune’s Weave Dagdan Collection': 'Fire Emblem: Fortune’s Weave',
    'Granblue Fantasy: Relink - Endless Ragnarok': 'Granblue Fantasy: Relink',
    'Granblue Fantasy: Relink - Endless Ragnarok (Standard Edition)': 'Granblue Fantasy: Relink',
    'Granblue Fantasy Versus: Rising Legendary Edition': 'Granblue Fantasy Versus: Rising',
    'hololive Treasure Mountain MegaPack – Nintendo Switch 2 Edition': 'Hololive Treasure Mountain',
    'Hyrule Warriors: Age of Calamity – Definitive Edition': 'Hyrule Warriors: Age of Calamity',
    'inKONBINI: One Store. Many Stories': 'inKonbini',
    'Jurassic World Evolution 2: Complete Edition': 'Jurassic World Evolution 2',
    'KINGDOM HEARTS III + Re Mind (DLC)': 'Kingdom Hearts III + Re Mind',
    'Little Nightmares Enhanced Edition - Complete Edition': 'Little Nightmares Enhanced Edition',
    'Little Nightmares II Enhanced Edition': 'Little Nightmares II',
    'Mamon King For Nintendo Switch 2': 'Mamon KIng',
    'Marvel\'s Guardians of the Galaxy: Encore Edition': 'Marvel\'s Guardians of the Galaxy',
    'Middle-earth: Shadow of Mordor Game of the Year Edition': 'Middle-earth: Shadow of Mordor',
    'Middle-earth: Shadow of War: Definitive Edition': 'Middle-earth: Shadow of War',
    'Minishoot\' Adventures – Nintendo Switch 2 Edition': 'Minishoot\' Adventure',
    'Model Debut4': 'Model Debut4 #nicola／モデルデビュー4 ニコラ',
    'NBA 2K26 SLAM Edition': 'NBA 2K26',
    'NOBUNAGA\'S AMBITION: Awakening Complete Edition': 'Nobunga\'s Ambition: Awakening',
    'Parkasaurus: Dinoluxe Edition': 'Parkasaurus',
    'Pikmin 4 – Nintendo Switch 2 Edition + Dandori Academy': 'Pikmin 4',
    'Planet of Lana II: Nintendo Switch 2 Edition': 'Planet of Lana 2',
    'RACCOIN: Chaos Max Edition': 'Raccoin: Coin Pusher Roguelike',
    'Relayer Advanced Definitive Edition': 'Relayer Advanced',
    'Rise of the Tomb Raider: 20 Year Celebration': 'Rise of the Tomb Raider',
    'Romancing SaGa 2: Revenge of the Seven – Nintendo Switch 2 Edition': 'Romancing Saga 2: Revenge of Seven',
    'Shadow Of The Tomb Raider: Definitive Edition': 'Shadow of the Tomb Raider',
    'Shadow Tactics: Blades of the Shogun Ultimate Bundle': 'Shadow Tactics: Blades of the Shogun',
    'SNØ: Ultimate Freeriding': 'SNØ',
    'Sonic Frontiers - Definitive Edition': 'Sonic Frontiers',
    'STEINS;GATE RE:BOOT Digital Deluxe Edition': 'Steins;Gate Re:Boot',
    'Suikoden I&II HD Remaster for Nintendo Switch 2 Gate Rune and Dunan Unification Wars': 'Suikoden I & II HD Remaster: Gate Rune and Dunan Unification Wars',
    'Teenage Mutant Ninja Turtles Arcade: Wrath of The Mutants - Ninja Edition': 'Teenage Mutant Ninja Turtles Arcade: Wrath of the Mutants',
    'THE ASCENT ULTIMATE EDITION': 'The Ascent',
    'The Crew Motorfest Deluxe Edition': 'The Crew Motorfest',
    'The Crew Motorfest Grand Garage Edition': 'The Crew Motorfest',
    'The Crew Motorfest Headliners Edition': 'The Crew Motorfest',
    'The Lord of the Rings: War in the North - Legacy Edition': 'The Lord of the Rings: War in the North',
    'The Prince of Tennis Doki Doki Survival ~eternal passion! Tie break ♡ game~ Nintendo Switch 2 Edition': 'The Prince of Tennis Doki Doki Survival eternal passion',
    'The Prince of Tennis Sweet School Festival ~♡-40 and more...~ Nintendo Switch 2 Edition': 'The Prince of Tennis Sweet School Festival 0-40 and more...',
    'The Relic: First Guardian': 'The Relic: The First Guardian',
    'Tombi! 2: The Evil Swine Return Special Edition': 'Tomba! 2: The Evil Swine Return Special Edition',
    'Tombi! Special Edition': 'Tomba! Special Edition',
    'Tomb Raider I-III Remastered Starring Lara Croft': 'Tomb Raider I-III Remastered',
    'Touhou Koumakyou: New Classic - the Embodiment of Scarlet Devil Deluxe Edition': 'Touhou Koumakyou: New Classic - the Embodiment of Scarlet Devil',
    'Two Point Hospital: Full Health Collection': 'Two Point Hospital',
    'Viractal: Will You Trust Your Party? Nintendo Switch 2 Edition': 'VIractal',
    'Virtua Fighter 5 R.E.V.O. World Stage': 'Virtua Fighter 5 R.E.V.O.',
    'Wo Long: Fallen Dynasty Complete Edition': 'Wo Long: Fallen Dynasty',
    'WWE 2K25 Standard Edition': 'WWE 2K25',
    'WWE 2K26 Standard Edition': 'WWE 2K26',
    'XENOTILT: HOSTILE PINBALL ACTION': 'XENOTILT',
    'ZERO PARADES: Director\'s Cut': 'ZERO PARADES',
}

PINNED_IDS = {
    'Resident Evil 2 Deluxe Edition': (29143, 'Deluxe Edition is the 2019 remake, not the 1998 original'),
    'Resident Evil 4 Gold Edition': (5332120, 'Gold Edition exists only for the 2023 remake'),
    'System Shock': (12164, 'Atari publishes the 2023 Nightdive remake, not the 1994 original'),
    'Destroy All Humans!': (5123056, 'THQ Nordic publishes the 2020 remake, not the 2005 original'),
    'Dispatch Nintendo Switch 2 Edition': (5473466, 'AdHoc Studio released Dispatch in 2025; the 2020 entry is another game'),
    'Supermarket Simulator': (5435201, 'Nokta Games released Supermarket Simulator on Steam in February 2024, matching this entry'),
    'Total Chaos': (5449667, 'The 2025 Total Chaos release date matches this entry; the 2018 entry is the Doom mod'),
    'Constance': (5409439, 'btf released Constance on 24 November 2025, matching this entry; the other entry is undated'),
}


def refine(row):
    title = clean(row['nintendo']['title'])
    if row['sgdb']:
        return row
    candidates = row.get('candidates', [])
    exact = [g for g in candidates if norm(g['name']) == norm(title)]
    if len(exact) > 1:
        year = (row['nintendo'].get('date_from') or '')[:4]
        same_year = [g for g in exact if g.get('release_date') and datetime.fromtimestamp(g['release_date'], timezone.utc).strftime('%Y') == year]
        if len(same_year) == 1:
            return dict(row, sgdb=same_year[0], method='exact_title_disambiguated_by_nintendo_release_year')
    alias = ALIASES.get(title) or re.sub(r'^(Arcade Archives 2|Console Archives)\s+', '', title)
    if alias != title:
        found = search(alias)
        exact = [g for g in found if norm(g['name']) == norm(alias)]
        if len(exact) == 1:
            return dict(row, sgdb=exact[0], method='explicit_port_or_edition_alias_to_shared_game', alias=alias,
                        queries=row.get('queries', []) + [alias])
        candidates = list({g['id']: g for g in candidates + found}.values())
        row = dict(row, alias=alias, queries=row.get('queries', []) + [alias], candidates=candidates)
    if title in PINNED_IDS:
        gid, reason = PINNED_IDS[title]
        names = {norm(title), norm(alias), norm(re.sub(r'\s*[-–—:]?\s*Nintendo Switch\s*2 Edition', '', title, flags=re.I))}
        pinned = [g for g in candidates if g['id'] == gid and norm(g['name']) in names]
        if len(pinned) == 1:
            return dict(row, sgdb=pinned[0], method='explicit_reviewed_id_for_duplicate_exact_titles', pinReason=reason)
    return row


def main():
    rows = json.loads((ROOT / 'matches.json').read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(refine, rows))
    save('matches.json', rows)
    save('matching-rules.json', {'normalization': 'Case, punctuation, Unicode diacritics, and trademark marks; ampersand becomes and',
        'acceptedMethods': ['Unique exact normalized title', 'Unique exact normalized title without Nintendo Switch 2 Edition',
            'Duplicate exact titles disambiguated by matching Nintendo release year',
            'Explicit named edition aliases or Arcade Archives 2 / Console Archives port labels',
            'Explicit reviewed SGDB ID among duplicate exact titles, with a recorded reason'],
        'aliases': ALIASES, 'pinnedIds': {k: {'sgdbId': v[0], 'reason': v[1]} for k, v in PINNED_IDS.items()}, 'ambiguities': 'Multiple exact candidates remain unmatched; no fuzzy matches are accepted'})
    export(rows)


if __name__ == '__main__':
    main()
