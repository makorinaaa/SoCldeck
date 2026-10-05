const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Deliberately report locations only: never echo a suspected credential.
function inspect(text) {
  const rules = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['provider-key', /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,})\b/],
    ['literal-api-key', /\b(?:api[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*["']([A-Za-z0-9_+/-]{20,})["']/i],
  ];
  return text.split(/\r?\n/).flatMap((line, index) => rules.flatMap(([rule, pattern]) => {
    const match = pattern.exec(line);
    if (!match || (rule === 'literal-api-key' && /example|placeholder|your[_-]|process\.env/i.test(match[1]))) return [];
    return [{ line: index + 1, rule }];
  }));
}

function scan(root) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const findings = [];
  for (const file of new Set(files)) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile()) continue;
    if (/^\.env(?:\.|$)/.test(path.basename(file)) && !/\.(?:example|sample|template)$/.test(file)) {
      findings.push({ file, line: 1, rule: 'tracked-env-file' });
    }
    const bytes = fs.readFileSync(absolute);
    if (bytes.includes(0)) continue;
    for (const finding of inspect(bytes.toString('utf8'))) findings.push({ file, ...finding });
  }
  return findings;
}

if (require.main === module) {
  const findings = scan(path.resolve(__dirname, '..'));
  for (const { file, line, rule } of findings) console.error(`${file}:${line}: ${rule}`);
  console.log(`Secret check: ${findings.length} finding(s). Known patterns only; Git history is not scanned.`);
  process.exitCode = findings.length ? 1 : 0;
}
module.exports = { inspect, scan };
