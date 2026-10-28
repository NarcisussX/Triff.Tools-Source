"""Complete the local QA data window using the same public Everef files as the worker.

Run verifyHullActivityCoverage.js --history first. This only writes the ignored
local cache; it does not connect to the deployment database.
"""
import bz2
import concurrent.futures
import csv
import datetime as dt
import json
import pathlib
import urllib.error
import urllib.request

CACHE = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'cache' / 'hull-activity'
hull_ids = {row['id'] for row in json.loads((CACHE / 'hulls.json').read_text(encoding='utf8'))}
history = json.loads((CACHE / 'history.json').read_text(encoding='utf8'))
dates_present = {row['date'] for row in history}
today = dt.datetime.now(dt.timezone.utc).date()
dates = [(today - dt.timedelta(days=n)).isoformat() for n in range(1, 421)]
missing = [day for day in dates if day not in dates_present]


def download(day):
    url = f'https://data.everef.net/market-history/{day[:4]}/market-history-{day}.csv.bz2'
    archive = CACHE / f'market-history-{day}.csv.bz2'
    if not archive.exists():
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'TriffTools-HullActivity-QA/1.0 (+https://www.triff.tools)'})
            with urllib.request.urlopen(request, timeout=90) as response:
                temporary = archive.with_suffix('.part')
                temporary.write_bytes(response.read())
                temporary.rename(archive)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return day, [], 'unavailable'
            raise
    rows = []
    with bz2.open(archive, 'rt', encoding='utf8', newline='') as stream:
        for row in csv.DictReader(stream):
            type_id = int(row['type_id'])
            if int(row['region_id']) == 10000002 and type_id in hull_ids:
                rows.append({'date': row['date'][:10], 'region_id': 10000002, 'type_id': type_id, 'volume': int(row['volume'])})
    return day, rows, 'downloaded'


if __name__ == '__main__':
    print(f'Completing {len(missing)} dates in the 420-day raw window', flush=True)
    statuses = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        for day, rows, status in executor.map(download, missing):
            history.extend(rows)
            statuses.append({'date': day, 'rows': len(rows), 'status': status})
            print(f'{day}: {len(rows)} real hull rows ({status})', flush=True)
    unique = {(r['date'], r['region_id'], r['type_id']): r for r in history if r['date'] in dates}
    (CACHE / 'history.json').write_text(json.dumps(list(unique.values())), encoding='utf8')
    (CACHE / 'history-sources.json').write_text(json.dumps(statuses, indent=2), encoding='utf8')
    print(f'Saved {len(unique)} rows across {len({r[0] for r in unique})} dates', flush=True)
