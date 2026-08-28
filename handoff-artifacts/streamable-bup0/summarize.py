from pathlib import Path
import json, shutil, statistics, math
out=Path(__file__).resolve().parent
base_path=out/'control-bup0.json'
if not base_path.exists():
 shutil.copy(Path(__file__).resolve().parents[3]/'agent-a5d21c2822ff46535/handoff-artifacts/fantasy-bench-validation/bup0/results.json',base_path)
base=json.loads(base_path.read_text()); control={(x['seed'],x['seat']):x['points'] for x in base['points'] if x['seed']<=8}
rows=[]; summaries={}
for rung in ['0.4','1.0']:
 source=Path('/private/tmp/streamable-bup0-'+rung+'/results.json')
 if not source.exists():continue
 shutil.copy(source,out/f'results-rung-{rung}.json');r=json.loads(source.read_text())
 deltas=[x['points']-control[(x['seed'],x['seat'])] for x in r['points']]
 seed_deltas=[statistics.mean([x['points']-control[(x['seed'],x['seat'])] for x in r['points'] if x['seed']==seed]) for seed in range(1,9)]
 summaries[rung]={'mean':statistics.mean(deltas),'paired_se':statistics.stdev(deltas)/math.sqrt(len(deltas)),'seed_cluster_se':statistics.stdev(seed_deltas)/math.sqrt(8),'seed_deltas':seed_deltas}
 rows.append(f"| {rung} | {r['train']['averagePoints']} ±{r['train']['pointsStandardError']} | {statistics.mean(deltas):+.1f} ±{statistics.stdev(deltas)/math.sqrt(len(deltas)):.1f} | {r['seconds']:.1f}s |")
(out/'paired-summary.json').write_text(json.dumps(summaries,indent=2))
print('\n'.join(rows)); print(json.dumps(summaries,indent=2))
