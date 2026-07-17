const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('pins and verifies the Windows FFmpeg distribution', () => {
  const installer = fs.readFileSync(path.join(root, 'scripts', 'install-ffmpeg.ps1'), 'utf8');
  assert.match(installer, /releases\/download\/\$version\/ffmpeg-\$version-essentials_build\.zip/);
  assert.match(installer, /db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec/);
  assert.match(installer, /System\.Security\.Cryptography\.SHA256/);
  assert.match(installer, /Get-Sha256Hash \$archivePath/);
  assert.doesNotMatch(installer, /Get-FileHash/);
});

test('packages only the verified binary and no deprecated FFmpeg wrappers', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['ffmpeg-static'], undefined);
  assert.equal(pkg.dependencies['fluent-ffmpeg'], undefined);
  assert.ok(pkg.scripts['build-win'].startsWith('npm run ffmpeg:install:win'));
  assert.deepEqual(pkg.build.win.extraResources, [
    {
      from: 'vendor/ffmpeg/win32-x64/ffmpeg.exe',
      to: 'ffmpeg/ffmpeg.exe',
    },
    {
      from: 'vendor/ffmpeg/README.md',
      to: 'ffmpeg/README.md',
    },
  ]);
});
