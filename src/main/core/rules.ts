import os from 'node:os'
import type { Rule } from './mojangTypes'

export type FeatureFlags = Record<string, boolean>

export function currentOsName(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  if (process.platform === 'linux') return 'linux'
  return process.platform
}

export function nativeArchSuffix(): string {
  if (process.arch === 'x64') return '64'
  if (process.arch === 'ia32') return '32'
  return process.arch
}

function archMatches(ruleArch?: string): boolean {
  if (!ruleArch) return true
  const arch = ruleArch.toLowerCase()
  if (arch === 'x86') return process.arch === 'ia32'
  if (arch === 'x86_64' || arch === 'amd64' || arch === 'x64') return process.arch === 'x64'
  if (arch === 'arm64' || arch === 'aarch64') return process.arch === 'arm64'
  return false
}

function osVersionMatches(pattern?: string): boolean {
  if (!pattern) return true
  try {
    return new RegExp(`^(?:${pattern})$`).test(os.release())
  } catch {
    return true
  }
}

function ruleMatches(rule: Rule, features: FeatureFlags): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== currentOsName()) return false
    if (!archMatches(rule.os.arch)) return false
    if (!osVersionMatches(rule.os.version)) return false
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if ((features[key] ?? false) !== expected) return false
    }
  }
  return true
}

export function isRuleAllowed(rules: Rule[] | undefined, features: FeatureFlags): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow'
  }
  return allowed
}
