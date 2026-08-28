import json,statistics,math
from pathlib import Path
p=Path(__file__).parent
base=json.load(open(p/'bup0-control.json'))['points']
variants=[]
for name in ['bup0-rollout48-seeds12','bup0-rollout48-seeds38','bup0-rollout48-seeds916']:
 f=p/(name+'.json')
 if f.exists():variants.extend(json.load(open(f)))
def stats(v):return {'mean':statistics.mean(v),'se':statistics.stdev(v)/math.sqrt(len(v)) if len(v)>1 else 0,'n':len(v)}
out={}
for name,lo,hi in [('discovery',0,96),('holdout',96,192)]:
 b=base[lo:min(hi,len(variants))];v=variants[lo:hi]
 if not v:continue
 delta=[y-x['points'] for x,y in zip(b,v)]
 seeds=[]
 for i in range(0,len(v),12):
  seeds.append({'seed':b[i]['seed'],'candidate':stats(v[i:i+12]),'delta':stats(delta[i:i+12])})
 out[name]={'candidate':stats(v),'control':stats([x['points'] for x in b]),'delta':stats(delta),'wins':sum(x>0 for x in delta),'perSeed':seeds,'seedClusterDelta':stats([s['delta']['mean'] for s in seeds])}
print(json.dumps(out,indent=2))
