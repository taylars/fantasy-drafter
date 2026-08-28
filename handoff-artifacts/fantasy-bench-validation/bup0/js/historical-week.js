// CSV sources contain quoted commas (notably in headshot URLs).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else field += c;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((key, i) => [key, r[i]])));
}

// Reserve codes are intentionally explicit: suspended/exempt/cut is not injured.
export function injuryDesignation(roster, report) {
  if (report?.report_status === 'Out') return 'Out';
  if (roster?.status === 'RES' && ['R01', 'R48', 'R04', 'R05', 'R27', 'R47'].includes(roster.status_description_abbr)) {
    return `Reserve:${roster.status_description_abbr}`;
  }
  return null;
}
