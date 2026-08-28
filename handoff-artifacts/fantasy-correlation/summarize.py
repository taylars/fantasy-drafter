import json,statistics,pathlib
root=pathlib.Path(__file__).resolve().parent
control=root.parents[2]/'agent-a5d21c2822ff46535/handoff-artifacts/fantasy-bench-validation/bup0/results.json'
b=json.loads(control.read_text());base={(r['seed'],r['seat']):r['points'] for r in b['points']}
for name in ['original-full','fixed-full','fixed-holdout']:
 p=root/f'{name}.json'
 if not p.exists(): continue
 d=json.loads(p.read_text());rows=d['rows'];g=d['grade']
 expected_seeds=range(9,17) if name=='fixed-holdout' else range(1,9)
 assert len(rows)==96 and {(r['seed'],r['seat']) for r in rows}=={(s,t) for s in expected_seeds for t in range(1,13)}
 assert round(statistics.mean(r['total'] for r in rows),1)==g['averagePoints']
 ds=[r['total']-base[r['seed'],r['seat']] for r in rows]
 seats=[statistics.mean(v for r,v in zip(rows,ds) if r['seat']==seat) for seat in range(1,13)]
 print(name,g)
 print(f"paired {statistics.mean(ds):.1f} ±{statistics.stdev(ds)/len(ds)**.5:.1f}; seat-cluster ±{statistics.stdev(seats)/12**.5:.1f}")
 print('per-seed',', '.join(f"{seed}:{statistics.mean(r['total'] for r in rows if r['seed']==seed):.1f}" for seed in sorted({r['seed'] for r in rows})))
 print('per-seed delta',', '.join(f"{seed}:{statistics.mean(v for r,v in zip(rows,ds) if r['seed']==seed):.1f}" for seed in sorted({r['seed'] for r in rows})))
 print('per-seat delta',seats)
