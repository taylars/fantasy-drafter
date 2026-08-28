export async function load(url, context, nextLoad) {
 const result = await nextLoad(url,context);
 if (!url.endsWith('/agent-aa78ed01a26c1c937/js/value.js')) return result;
 let source = String(result.source).replace('const BENCH_UPSIDE_POINTS = 10.0;', 'const BENCH_UPSIDE_POINTS = 0;');
 if (process.env.DEDUP === '1') source = source.replace('  const byTeam = new Map();', `  const unique = new Map();
  for (const [p,w] of started) unique.set(p, (unique.get(p) ?? 0) + w);
  started = [...unique];
  const byTeam = new Map();`);
 return {...result, source};
}
