import json, statistics, math, pathlib
for label, control in [('flat','baseline'),('bup0','bup0')]:
 p=pathlib.Path('/private/tmp/ceiling-'+label+'.json')
 if not p.exists():continue
 r=json.loads(p.read_text()); b=json.load(open('/private/tmp/fantasy-bench-validation/'+control+'/results.json'))
 lookup={(x['seed'],x['seat']):x['points'] for x in b['points']}
 ds=[x['results'][x['heroSeat']-1]['total']-lookup[x['seed'],x['heroSeat']] for x in r['runs']]
 print(label, r['grade'], 'paired delta',statistics.mean(ds),'SE',statistics.stdev(ds)/math.sqrt(len(ds)))
 print('seedmeans', {s:statistics.mean(x['results'][x['heroSeat']-1]['total'] for x in r['runs'] if x['seed']==s) for s in range(1,9)})
 print('seeddeltas', {s:statistics.mean(x['results'][x['heroSeat']-1]['total']-lookup[x['seed'],x['heroSeat']] for x in r['runs'] if x['seed']==s) for s in range(1,9)})
