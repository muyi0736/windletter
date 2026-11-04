import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface MemoryReleaseResult {
  beforeKb: number
  afterKb: number
  processes?: number
}

/**
 * 回收启动器和（可选）系统进程的工作集。不申请管理员权限；
 * 深度清理（待机/已修改列表）在 index.ts 的独立入口中执行。
 */
export async function releaseMemory(
  scope: 'app' | 'system',
  signal?: AbortSignal
): Promise<MemoryReleaseResult> {
  const totalKb = (): number =>
    app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory?.workingSetSize ?? 0), 0)
  const beforeKb = totalKb()
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      const dbg = win.webContents.debugger
      if (!dbg.isAttached()) dbg.attach('1.3')
      await dbg.sendCommand('HeapProfiler.collectGarbage').catch(() => undefined)
      await dbg
        .sendCommand('Memory.simulatePressureNotification', { level: 'critical' })
        .catch(() => undefined)
      dbg.detach()
    } catch {
      /* 调试器不可用时只做系统级回收 */
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 250))

  if (process.platform === 'win32' && scope === 'system') {
    const script = `$code = @'
using System;
using System.Runtime.InteropServices;
public static class WindletterMemory {
  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);
}
'@
Add-Type -TypeDefinition $code
$before = (Get-CimInstance Win32_Process | Measure-Object -Property WorkingSetSize -Sum).Sum
$count = 0
Get-Process | ForEach-Object { try { if ([WindletterMemory]::EmptyWorkingSet($_.Handle)) { $script:count++ } } catch {} }
Start-Sleep -Milliseconds 600
$after = (Get-CimInstance Win32_Process | Measure-Object -Property WorkingSetSize -Sum).Sum
[pscustomobject]@{ before = [double]$before; after = [double]$after; count = $script:count } | ConvertTo-Json -Compress`
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: 45000, signal }
      )
      const parsed = JSON.parse(stdout.trim() || '{}') as {
        before?: number
        after?: number
        count?: number
      }
      if (typeof parsed.before === 'number' && typeof parsed.after === 'number') {
        return {
          beforeKb: Math.round(parsed.before / 1024),
          afterKb: Math.round(parsed.after / 1024),
          processes: Number(parsed.count) || 0
        }
      }
    } catch {
      /* 回退到只回收启动器自身 */
    }
  }

  const pids = [...new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)])]
  if (process.platform === 'win32' && pids.length > 0) {
    const script = `$code = @'
using System;
using System.Runtime.InteropServices;
public static class WindletterMemory {
  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);
}
'@
Add-Type -TypeDefinition $code
Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { [WindletterMemory]::EmptyWorkingSet($_.Handle) | Out-Null }`
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 15000, signal }
    ).catch(() => undefined)
  }
  await new Promise((resolve) => setTimeout(resolve, 700))
  return { beforeKb, afterKb: totalKb() }
}
