import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { TaskContract, TestResult } from '../commander/types.js';
import type { BuilderProvider } from '../providers/provider.js';
import type { TargetLock } from '../orchestration/target-resolver.js';
import type { RepairRequest } from '../orchestration/repair-request.js';

export interface BuilderRequest {
  task: TaskContract;
  target: TargetLock;
  workspacePath: string;
  baseSha: string;
  branch: string;
  /**
   * Present only for a repair attempt (see RepairRequest.kind === 'repair'),
   * absent for an initial build -- this is what makes the two request
   * shapes explicitly distinguishable on the wire, without a second
   * Builder execution path.
   */
  repair?: RepairRequest;
}

export interface BuilderResponse {
  summary: string;
  knownLimitations?: string[];
}

export interface VerificationCommand {
  name: string;
  executable: string;
  args: string[];
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  content?: string;
}

export interface BuilderWorkProduct {
  taskId: string;
  provider: string;
  summary: string;
  branch: string;
  baseSha: string;
  changedFiles: string[];
  changes: FileChange[];
  tests: TestResult[];
  knownLimitations: string[];
}

export interface VerificationPlanner {
  plan(workspacePath: string): Promise<VerificationCommand[]>;
}

/**
 * What ref/exact-SHA a workspace checkout must start from. Defaults to the
 * task's locked base branch; a repair attempt instead points at the task's
 * own remote branch at the previous attempt's exact published SHA, so the
 * repair workspace already contains everything that attempt published --
 * the Builder repairs the current task branch state, not a reconstruction
 * of it from the original base.
 */
export interface WorkspaceStart {
  ref: string;
  sha: string;
}

/**
 * The deterministic branch name Commander publishes a task to. Shared
 * between workspace preparation and the repair-continuity fetch so both
 * always agree on which remote branch a repair continues from.
 */
export function deriveTaskBranchName(taskId: string, baseSha: string): string {
  return `commander/${taskId.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 48)}-${baseSha.slice(0, 8)}`;
}

interface ProcessResult {
  code: number;
  stdout: string;
}

function safeProcessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot']) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  return environment;
}

async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs = 10 * 60_000,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: safeProcessEnvironment(),
    });
    let stdout = '';
    let stderrBytes = 0;
    const maxBytes = 256 * 1024;
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (Buffer.byteLength(stdout, 'utf8') <= maxBytes) stdout += chunk;
    });
    child.stderr.on('data', (chunk: Uint8Array) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxBytes) child.kill('SIGKILL');
    });
    child.on('error', () => {
      clearTimeout(timeout);
      reject(new Error('PROCESS_START_FAILED'));
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      resolveResult({ code: code ?? 1, stdout });
    });
  });
}

export class NodePackageVerificationPlanner implements VerificationPlanner {
  public async plan(workspacePath: string): Promise<VerificationCommand[]> {
    let manifest: { scripts?: Record<string, string> };
    try {
      manifest = JSON.parse(await readFile(join(workspacePath, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
    } catch {
      throw new Error('NO_AUTOMATIC_VERIFICATION_PLAN');
    }

    const commands: VerificationCommand[] = [
      {
        name: 'install',
        executable: 'npm',
        args: ['install', '--no-audit', '--no-fund', '--package-lock=false'],
      },
    ];
    for (const name of ['lint', 'typecheck', 'test', 'build']) {
      if (manifest.scripts?.[name]) {
        commands.push({ name, executable: 'npm', args: ['run', name] });
      }
    }
    if (commands.length === 1) throw new Error('NO_AUTOMATIC_VERIFICATION_PLAN');
    return commands;
  }
}

export class LocalGitWorkspaceManager {
  public async prepare(
    taskId: string,
    target: TargetLock,
    baseSha: string,
    start?: WorkspaceStart,
  ): Promise<{ path: string; branch: string }> {
    const workspacePath = await mkdtemp(join(tmpdir(), 'commander-'));
    const branch = deriveTaskBranchName(taskId, baseSha);
    const effectiveStart: WorkspaceStart = start ?? { ref: target.baseBranch, sha: baseSha };
    try {
      const remote = `https://github.com/${target.repository}.git`;
      for (const [executable, args] of [
        ['git', ['init']],
        ['git', ['remote', 'add', 'origin', remote]],
        ['git', ['fetch', '--depth=1', 'origin', effectiveStart.ref]],
      ] as const) {
        const result = await runProcess(executable, [...args], workspacePath);
        if (result.code !== 0) throw new Error('WORKSPACE_FETCH_FAILED');
      }
      // Commander-owned, git-level fail-closed check: what the remote's
      // ref actually points at right now must exactly match what this
      // workspace was told to start from (the locked base SHA for an
      // initial attempt, or the previous attempt's exact published SHA for
      // a repair). This is the same check for both cases -- it is what
      // makes a repair's starting tree provably the prior attempt's exact
      // state rather than an assumption. The Builder subprocess itself
      // never needs GitHub credentials or does any fetching of its own;
      // this happens entirely before it is invoked.
      const fetched = (await runProcess('git', ['rev-parse', 'FETCH_HEAD'], workspacePath)).stdout.trim();
      if (fetched.toLowerCase() !== effectiveStart.sha.toLowerCase()) {
        throw new Error(start ? 'REPAIR_START_SHA_MISMATCH' : 'BASE_SHA_MOVED');
      }
      if ((await runProcess('git', ['checkout', '--detach', effectiveStart.sha], workspacePath)).code !== 0) {
        throw new Error('WORKSPACE_CHECKOUT_FAILED');
      }
      if ((await runProcess('git', ['switch', '-c', branch], workspacePath)).code !== 0) {
        throw new Error('WORKSPACE_BRANCH_FAILED');
      }
      return { path: workspacePath, branch };
    } catch (error) {
      await this.cleanup(workspacePath);
      throw error;
    }
  }

  public async collectChanges(workspacePath: string, baseSha: string): Promise<FileChange[]> {
    const trackedResult = await runProcess(
      'git',
      ['diff', '--name-status', '--no-renames', baseSha, '--'],
      workspacePath,
    );
    if (trackedResult.code !== 0) throw new Error('CHANGE_DISCOVERY_FAILED');
    const untrackedResult = await runProcess(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      workspacePath,
    );
    if (untrackedResult.code !== 0) throw new Error('CHANGE_DISCOVERY_FAILED');

    const statuses = new Map<string, FileChange['status']>();
    for (const line of trackedResult.stdout.split('\n').filter(Boolean)) {
      const tab = line.indexOf('\t');
      if (tab < 1) throw new Error('CHANGE_DISCOVERY_FAILED');
      const code = line.slice(0, tab);
      const path = line.slice(tab + 1);
      statuses.set(path, code === 'D' ? 'deleted' : code === 'A' ? 'added' : 'modified');
    }
    for (const path of untrackedResult.stdout.split('\n').filter(Boolean)) statuses.set(path, 'added');

    const changes: FileChange[] = [];
    for (const [path, status] of [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (status === 'deleted') {
        changes.push({ path, status });
        continue;
      }
      const absolute = resolve(workspacePath, path);
      const root = resolve(workspacePath) + sep;
      if (!absolute.startsWith(root)) throw new Error('UNSAFE_CHANGED_PATH');
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('UNSUPPORTED_CHANGED_FILE');
      const buffer = await readFile(absolute);
      if (buffer.includes(0)) throw new Error('UNSUPPORTED_BINARY_CHANGE');
      changes.push({ path, status, content: buffer.toString('utf8') });
    }
    return changes;
  }

  public async cleanup(workspacePath: string): Promise<void> {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

export class ManagedBuilderRunner {
  public constructor(
    private readonly provider: BuilderProvider<BuilderRequest, BuilderResponse>,
    private readonly workspace = new LocalGitWorkspaceManager(),
    private readonly planner: VerificationPlanner = new NodePackageVerificationPlanner(),
  ) {}

  public async run(
    task: TaskContract,
    target: TargetLock,
    baseSha: string,
    repair?: RepairRequest,
  ): Promise<BuilderWorkProduct> {
    if (task.targetRepository.toLowerCase() !== target.repository.toLowerCase()) {
      throw new Error('TASK_TARGET_MISMATCH');
    }

    // A repair continues from the previous attempt's exact published state,
    // not the original base -- otherwise the Builder would be repairing a
    // reconstruction of its prior work instead of the prior work itself,
    // and any file it doesn't re-touch this attempt would silently lose
    // whatever the previous attempt did to it. A repair triggered before
    // any publish ever happened (a local-verification failure on the very
    // first attempt) has no previous published SHA to start from and
    // correctly falls back to the locked base, same as an initial attempt.
    let start: WorkspaceStart | undefined;
    let diffBase = baseSha;
    if (repair?.previousBuilderSha) {
      if (
        !repair.pullRequestHeadSha ||
        repair.previousBuilderSha.toLowerCase() !== repair.pullRequestHeadSha.toLowerCase()
      ) {
        throw new Error('REPAIR_EVIDENCE_SHA_MISMATCH');
      }
      start = { ref: deriveTaskBranchName(task.id, baseSha), sha: repair.previousBuilderSha };
      diffBase = repair.previousBuilderSha;
    }

    const prepared = await this.workspace.prepare(task.id, target, baseSha, start);
    try {
      const captured = await this.provider.build({
        task,
        target,
        workspacePath: prepared.path,
        baseSha: diffBase,
        branch: prepared.branch,
        ...(repair ? { repair } : {}),
      });
      if (captured.provider !== this.provider.name) throw new Error('BUILDER_PROVIDER_MISMATCH');

      const commands = await this.planner.plan(prepared.path);
      const tests: TestResult[] = [];
      for (const command of commands) {
        const result = await runProcess(command.executable, command.args, prepared.path);
        tests.push({
          name: command.name,
          command: [command.executable, ...command.args].join(' '),
          conclusion: result.code === 0 ? 'success' : 'failure',
          evidence: `exit=${result.code}`,
        });
        if (result.code !== 0) break;
      }
      // Relative to diffBase (the previous attempt's exact SHA for a
      // repair, or the locked base otherwise), so this is the true
      // incremental repair delta -- not a reconstruction of the whole task.
      const changes = await this.workspace.collectChanges(prepared.path, diffBase);
      if (changes.length === 0) throw new Error('BUILDER_PRODUCED_NO_CHANGES');

      return {
        taskId: task.id,
        provider: this.provider.name,
        summary: captured.payload.summary,
        branch: prepared.branch,
        baseSha: diffBase,
        changedFiles: changes.map((change) => change.path),
        changes,
        tests,
        knownLimitations: captured.payload.knownLimitations ?? [],
      };
    } finally {
      await this.workspace.cleanup(prepared.path);
    }
  }
}
