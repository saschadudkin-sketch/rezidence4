#!/usr/bin/env node
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const node = process.execPath;
const preflight = path.join(repoRoot, 'scripts', 'playwright-preflight.cjs');
const playwrightCli = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const webServerScript = path.join(repoRoot, 'scripts', 'run-playwright-webserver.cjs');
const forwardedArgs = process.argv.slice(2);
const runOutputRoot = path.join('test-results', `e2e-${Date.now()}-${process.pid}`);
const failOnInfrastructureRetry = process.env.E2E_FAIL_ON_INFRA_RETRY === '1'
  || forwardedArgs.includes('--fail-on-infra-retry');
let infrastructureRetryCount = 0;
const defaultRuns = [
  { project: 'chromium', target: 'e2e/login-flow.spec.js' },
  { project: 'chromium', target: 'e2e/navigation-role-matrix.spec.js' },
  { project: 'chromium', target: 'e2e/navigation.spec.js' },
  { project: 'chromium', target: 'e2e/pass-create.spec.js' },
  { project: 'chromium', target: 'e2e/pass-flow.spec.js' },
  { project: 'mobile', target: 'e2e/mobile-interaction-contract.spec.js' },
  { project: 'mobile', target: 'e2e/navigation-mobile.spec.js' },
];

function sleep(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function writeChildOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function isProcessCrashStatus(status) {
  return status === -1073741819 || status === 3221225477;
}

function writeInfrastructureDiagnostic(args, attempt, result, reason) {
  const diagnosticDir = path.join(repoRoot, runOutputRoot, 'infrastructure');
  fs.mkdirSync(diagnosticDir, { recursive: true });
  const filePath = path.join(diagnosticDir, `attempt-${Date.now()}-${attempt}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    reason,
    attempt,
    command: [node, ...args],
    status: result.status,
    signal: result.signal,
    stdoutTail: String(result.stdout || '').slice(-4000),
    stderrTail: String(result.stderr || '').slice(-4000),
  }, null, 2));
  return filePath;
}

function isRetryablePlaywrightInfrastructureFailure(result) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return (
    result.status === 1
    && (
      output.includes('browserType.launch: Target page, context or browser has been closed')
      || output.includes('browserContext.newPage: Test timeout of 60000ms exceeded')
      || output.includes('exitCode=3221225477')
      || output.includes('worker process exited unexpectedly (code=3221225477')
      || output.includes('Error: spawn EPERM')
    )
  );
}

function runNode(args, { retryLaunch = false, extraEnv = {} } = {}) {
  const maxAttempts = retryLaunch ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(node, args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (!result.error && retryLaunch && isProcessCrashStatus(result.status) && attempt < maxAttempts) {
      writeChildOutput(result);
      infrastructureRetryCount += 1;
      const diagnosticPath = writeInfrastructureDiagnostic(args, attempt, result, 'process-crash-before-verdict');
      console.warn(`[e2e] Playwright child crashed before verdict; retrying (${attempt}/${maxAttempts}); diagnostic=${diagnosticPath}`);
      sleep(1500 * attempt);
      continue;
    }

    if (!result.error && retryLaunch && isRetryablePlaywrightInfrastructureFailure(result) && attempt < maxAttempts) {
      writeChildOutput(result);
      infrastructureRetryCount += 1;
      const diagnosticPath = writeInfrastructureDiagnostic(args, attempt, result, 'retryable-playwright-infrastructure-failure');
      console.warn(`[e2e] Playwright infrastructure failure before app verdict; retrying shard (${attempt}/${maxAttempts}); diagnostic=${diagnosticPath}`);
      sleep(1500 * attempt);
      continue;
    }

    if (!result.error) {
      writeChildOutput(result);
      if (retryLaunch && isProcessCrashStatus(result.status)) {
        const diagnosticPath = writeInfrastructureDiagnostic(args, attempt, result, 'process-crash-final');
        console.error(`[e2e] Playwright child crashed before verdict after ${attempt} attempt(s); status=${result.status}; signal=${result.signal || 'none'}; diagnostic=${diagnosticPath}`);
        return 1;
      }
      return result.status ?? 1;
    }

    const retryable = result.error.code === 'EPERM' || result.error.code === 'EACCES';
    if (!retryable || attempt === maxAttempts) {
      writeChildOutput(result);
      console.error(result.error.message);
      return 1;
    }

    writeChildOutput(result);
    console.warn(`[e2e] ${result.error.code} while launching Playwright; retrying (${attempt}/${maxAttempts})`);
    sleep(1500 * attempt);
  }

  return 1;
}

function canReachWebServer() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:3000/', (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForWebServer(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await canReachWebServer()) {
      return true;
    }
    sleep(500);
  }

  return false;
}

async function startWebServer() {
  if (await canReachWebServer()) {
    return null;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const child = spawn(node, [webServerScript], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });

    const launchError = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 1000);

      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(error);
        }
      });

      child.once('exit', (code, signal) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(new Error(`webServer exited before ready: code=${code}, signal=${signal}`));
        }
      });
    });

    if (launchError) {
      if (attempt < 3) {
        infrastructureRetryCount += 1;
        const reason = launchError.code || launchError.message;
        console.warn(`[e2e] ${reason} while launching webServer; retrying (${attempt}/3)`);
        sleep(1500 * attempt);
        continue;
      }
      throw launchError;
    }

    if (await waitForWebServer()) {
      return child;
    }

    child.kill();
    if (attempt < 3) {
      infrastructureRetryCount += 1;
      console.warn(`[e2e] webServer did not become ready; retrying (${attempt}/3)`);
      sleep(1500 * attempt);
    }
  }

  throw new Error('webServer did not become ready');
}

async function main() {
  const effectiveArgs = forwardedArgs.filter((arg) => arg !== '--fail-on-infra-retry');
  let status = runNode([preflight]);
  if (status !== 0) {
    process.exit(status);
  }

  sleep(1500);

  const usesExplicitSelection = forwardedArgs.some((arg) => (
    arg === '--list'
    || arg === '--ui'
    || arg === '--debug'
    || arg.startsWith('--project')
    || !arg.startsWith('-')
  ));
  const hasOutputOverride = forwardedArgs.some((arg) => arg === '--output' || arg.startsWith('--output='));
  const hasRetriesOverride = forwardedArgs.some((arg) => arg === '--retries' || arg.startsWith('--retries='));

  if (usesExplicitSelection) {
    const needsWebServer = !forwardedArgs.some((arg) => (
      arg === '--list'
      || arg === '--ui'
      || arg === '--debug'
    ));
    const webServer = needsWebServer && !process.env.PLAYWRIGHT_SKIP_WEBSERVER
      ? await startWebServer()
      : null;

    try {
      status = runNode([playwrightCli, 'test', ...effectiveArgs], {
        retryLaunch: true,
        extraEnv: needsWebServer ? { PLAYWRIGHT_SKIP_WEBSERVER: '1' } : {},
      });
      if (status === 0 && failOnInfrastructureRetry && infrastructureRetryCount > 0) {
        console.error(`[e2e] failing strict run because infrastructureRetries=${infrastructureRetryCount}`);
        status = 1;
      }
    } finally {
      if (webServer && !webServer.killed) {
        webServer.kill();
      }
    }
    process.exit(status);
  }

  const webServer = await startWebServer();

  try {
    const retryArgs = hasRetriesOverride ? [] : ['--retries=0'];

    for (const { project, target } of defaultRuns) {
      console.log(`[e2e] ${project}: ${target}`);
      const outputName = target.replace(/^e2e\//, '').replace(/[^a-z0-9_.-]/gi, '-');
      const outputArgs = hasOutputOverride ? [] : ['--output', path.join(runOutputRoot, project, outputName)];
      status = runNode(
        [playwrightCli, 'test', target, `--project=${project}`, ...outputArgs, ...retryArgs, ...effectiveArgs],
        { retryLaunch: true, extraEnv: { PLAYWRIGHT_SKIP_WEBSERVER: '1' } },
      );
      if (status !== 0) {
        break;
      }
      sleep(3000);
    }
  } finally {
    if (webServer && !webServer.killed) {
      webServer.kill();
    }
  }

  if (status !== 0) {
    process.exit(status);
  }

  console.log(`[e2e] all selected shards passed; outputRoot=${runOutputRoot}; infrastructureRetries=${infrastructureRetryCount}`);
  if (status === 0 && failOnInfrastructureRetry && infrastructureRetryCount > 0) {
    console.error(`[e2e] failing strict run because infrastructureRetries=${infrastructureRetryCount}`);
    status = 1;
  }
  process.exit(status);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
