/* eslint-disable @typescript-eslint/no-explicit-any -- Error types vary */
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
function ensureLogDir() {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
/**
 * Format timestamp for log entry.
 */
function formatTimestamp() {
    return new Date().toISOString();
}
/**
 * Write maintenance log to file only (not console).
 * @param level - Log level (INFO, WARN, ERROR)
 * @param message - Log message
 */
export function logMaintenance(level, message) {
    try {
        ensureLogDir();
        const timestamp = formatTimestamp();
        const logLine = `${timestamp} [${level}] ${message}\n`;
        fs.appendFileSync(LOG_FILE, logLine);
    }
    catch (error) {
        // Silently ignore file write errors to avoid cascading failures
        // Only log to console as last resort (should never happen)
        if (process.env.DEBUG === 'memory') {
            const errMsg = error instanceof Error ? error.message : String(error);
            // eslint-disable-next-line no-console -- Last resort fallback for debugging
            console.error('[MaintenanceLogger] Failed to write log:', errMsg);
        }
    }
}
/**
 * Log info level message.
 */
export function logInfo(message) {
    logMaintenance('INFO', message);
}
/**
 * Log warning level message.
 */
export function logWarn(message) {
    logMaintenance('WARN', message);
}
/**
 * Log error level message.
 */
export function logError(message) {
    logMaintenance('ERROR', message);
}
/**
 * Error severity levels for unified error handling.
 */
export var ErrorSeverity;
(function (ErrorSeverity) {
    ErrorSeverity["CRITICAL"] = "critical";
    ErrorSeverity["WARNING"] = "warning";
    ErrorSeverity["INFO"] = "info";
})(ErrorSeverity || (ErrorSeverity = {}));
/**
 * Unified error handling - logs with stack trace and handles by severity.
 * @param error - The error object
 * @param context - Context string (e.g., 'vectorSearch', 'processQueue')
 * @param severity - Error severity level
 * @returns void (throws for CRITICAL, logs for others)
 */
export function handleError(error, context, severity = ErrorSeverity.WARNING) {
    const errorMsg = error?.message || String(error);
    const stackTrace = error?.stack || '';
    if (severity === ErrorSeverity.CRITICAL) {
        logError(`[${context}] CRITICAL: ${errorMsg}`);
        if (stackTrace) {
            logError(`[${context}] Stack: ${stackTrace}`);
        }
        throw error; // Re-throw for critical errors
    }
    else if (severity === ErrorSeverity.WARNING) {
        logWarn(`[${context}] ${errorMsg}`);
        if (stackTrace) {
            logWarn(`[${context}] Stack: ${stackTrace}`);
        }
    }
    else {
        // INFO level - minimal logging
        logInfo(`[${context}] ${errorMsg}`);
    }
}
//# sourceMappingURL=maintenance-logger.js.map