// Launch with a clean child environment before importing any application module.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Runs before the TS loader.
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Runs before the TS loader.
const { spawnSync } = require('node:child_process');

function isolatedEnvironment(original) {
  const env = { NODE_ENV: 'test', TZ: 'Asia/Manila', TSX_DISABLE_CACHE: '1', ATTENDANCE_TEST_ISOLATED: '1', PATH: path.dirname(process.execPath) };
  for (const name of ['SystemRoot', 'WINDIR', 'ComSpec', 'SystemDrive', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
    if (original[name] !== undefined) env[name] = original[name];
  }
  return env;
}
module.exports = { isolatedEnvironment };
if (require.main === module) {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    process.stderr.write('STOP: Use the existing Node 24 runtime. No dependencies need installation.\n');
    process.exitCode = 1;
  } else {
    const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', './src/scripts/attendanceTest/main.ts', ...process.argv.slice(2)], {
      cwd: path.resolve(__dirname, '..'), env: isolatedEnvironment(process.env), encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 2000000,
    });
    // Main emits one allowlisted, redacted JSON object. Never forward raw runtime/loader errors.
    try {
      const report = JSON.parse(result.stdout);
      if (report.tool !== 'attendance-test' || !['blocked', 'complete'].includes(report.status)) throw new Error();
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } catch { process.stderr.write('STOP: Test runner failed or timed out; raw diagnostic output was suppressed.\n'); }
    process.exitCode = result.status === 0 ? 0 : 1;
  }
}
