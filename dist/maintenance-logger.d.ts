/**
 * Maintenance Logger - writes maintenance logs to file only (not console).
 * This prevents TUI flooding while keeping logs for debugging.
 */
/**
 * Write maintenance log to file only (not console).
 * @param level - Log level (INFO, WARN, ERROR)
 * @param message - Log message
 */
export declare function logMaintenance(level: 'INFO' | 'WARN' | 'ERROR', message: string): void;
/**
 * Log info level message.
 */
export declare function logInfo(message: string): void;
/**
 * Log warning level message.
 */
export declare function logWarn(message: string): void;
/**
 * Log error level message.
 */
export declare function logError(message: string): void;
/**
 * Error severity levels for unified error handling.
 */
export declare enum ErrorSeverity {
    CRITICAL = "critical",// Must interrupt flow, throw error
    WARNING = "warning",// Can continue, log and proceed
    INFO = "info"
}
/**
 * Unified error handling - logs with stack trace and handles by severity.
 * @param error - The error object
 * @param context - Context string (e.g., 'vectorSearch', 'processQueue')
 * @param severity - Error severity level
 * @returns void (throws for CRITICAL, logs for others)
 */
export declare function handleError(error: Error | any, context: string, severity?: ErrorSeverity): void;
//# sourceMappingURL=maintenance-logger.d.ts.map