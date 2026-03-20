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
//# sourceMappingURL=maintenance-logger.d.ts.map