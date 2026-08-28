// Keep progress on stderr so --json stdout remains a parseable result file.
export function matrixProgress({
  write = (line) => process.stderr.write(`${line}\n`),
  now = () => performance.now(), intervalMs = 5000,
} = {}) {
  const started = now();
  let lastPrinted = -Infinity;
  const duration = (ms) => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
  return (event) => {
    const time = now();
    if (event.type === "draft" && time - lastPrinted < intervalMs) return;
    lastPrinted = time;
    const elapsed = time - started;
    if (event.type === "start") {
      write(`[matrix] Starting ${event.configurations} configurations × 2 strategies; ${event.total} drafts; seed ${event.seed}`);
      return;
    }
    if (event.type === "complete") {
      write(`[matrix] Complete: ${event.completed}/${event.total} drafts (100%) | elapsed ${duration(elapsed)}`);
      return;
    }
    const { config, strategy, heroSeat, configIndex, configurations, completed, total } = event;
    const percent = total ? (100 * completed / total).toFixed(1) : "0.0";
    const eta = completed ? duration(elapsed / completed * (total - completed)) : "estimating";
    write(`[matrix] ${strategy.toUpperCase()} ${configIndex}/${configurations} | ` +
      `${config.teams} teams ${config.draftType} ${config.rosterShape} ${config.format} ${config.opponentStyle} | ` +
      `seat ${heroSeat}/${config.teams} | ${completed}/${total} drafts (${percent}%) | ` +
      `elapsed ${duration(elapsed)} | rough ETA ${eta}`);
  };
}
