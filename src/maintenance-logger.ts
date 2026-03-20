/**
 * Maintenance Logger - writes maintenance logs to file only (not console).
 * This prevents TUI flooding while keeping logs for debugging.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.env.HOME || '~', '.openclaw', 'logs', 'memory-maintenance.log');

/**
 * Ensure log directory exists.
 */
function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Format timestamp for log entry.
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Write maintenance log to file only (not console).
 * @param level - Log level (INFO, WARN, ERROR)
 * @param message - Log message
 */
export function logMaintenance(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  try {
    ensureLogDir();
    const timestamp = formatTimestamp();
    const logLine = `${timestamp} [${level}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (error: any) {
    // Silently ignore file write errors to avoid cascading failures
    // Only log to console as last resort (should never happen)
    if (process.env.DEBUG === 'memory') {
      console.error('[MaintenanceLogger] Failed to write log:', error.message);
    }
  }
}

/**
 * Log info level message.
 */
export function logInfo(message: string): void {
  logMaintenance('INFO', message);
}

/**
 * Log warning level message.
 */
export function logWarn(message: string): void {
  logMaintenance('WARN', message);
}

/**
 * Log error level message.
 */
export function logError(message: string): void {
  logMaintenance('ERROR', message);
}
