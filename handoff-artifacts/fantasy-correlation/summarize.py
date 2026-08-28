import json,statistics,pathlib
root=pathlib.Path('/private/tmp/fantasy-correlation')
b=json.loads(pathlib.Path('/private/tmp/fantasy-bench-validation/bup0/results.json').read_text());base={(r['seed'],r['seat']):r['points'] for r in b['points']}
for name in ['original-full','fixed-full','fixed-holdout']:
 p=root/f'{name}.json'
 if not p.exists(): continue
 d=json.loads(p.read_text());rows=d['rows'];g=d['grade'];ds=[r['total']-base[r['seed'],r['seat']] for r in rows]
 seats=[statistics.mean(v for r,v in zip(rows,ds) if r['seat']==seat) for seat in range(1,13)]
 print(name,g)
 print(f"paired {statistics.mean(ds):.1f} ±{statistics.stdev(ds)/len(ds)**.5:.1f}; seat-cluster ±{statistics.stdev(seats)/12**.5:.1f}")
 print('per-seed',', '.join(f"{seed}:{statistics.mean(r['total'] for r in rows if r['seed']==seed):.1f}" for seed in sorted({r['seed'] for r in rows})))
 print('per-seed delta',', '.join(f"{seed}:{statistics.mean(v for r,v in zip(rows,ds) if r['seed']==seed):.1f}" for seed in sorted({r['seed'] for r in rows})))
 print('per-seat delta',seats)
