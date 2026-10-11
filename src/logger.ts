import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Minimal Log4j / Spring Boot style logger.
 *
 * Output follows Spring Boot's default console pattern:
 *   2026-10-11T14:03:12.345+07:00  INFO 4242 --- [bill-please-mcp] [9f2c1a7e] receipts.route : Scanned 4 items
 * The "thread" slot shows the current request id (like an MDC value), or
 * `main` outside a request.
 */

export const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  OFF: 5,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  TRACE: '\x1b[37m',
  DEBUG: '\x1b[32m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  OFF: '',
};
const RESET = '\x1b[0m';
const FAINT = '\x1b[2m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

export interface LoggerOptions {
  level: LogLevel;
  appName: string;
  color: boolean;
  /** Where formatted lines go; defaults to stdout/stderr */
  write: (line: string, level: LogLevel) => void;
}

const defaultWrite = (line: string, level: LogLevel) => {
  if (SEVERITY[level] >= SEVERITY.WARN) process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
};

const options: LoggerOptions = {
  level: 'INFO',
  appName: 'bill-please-mcp',
  color: process.stdout.isTTY === true && !Bun.env.NO_COLOR,
  write: defaultWrite,
};

export const configureLogger = (overrides: Partial<LoggerOptions>) => {
  Object.assign(options, overrides);
};

export const parseLogLevel = (value: string | undefined, fallback: LogLevel = 'INFO'): LogLevel => {
  const upper = value?.trim().toUpperCase();
  return (LOG_LEVELS as readonly string[]).includes(upper ?? '') ? (upper as LogLevel) : fallback;
};

/** Per-request context, the equivalent of Log4j's MDC */
export interface LogContext {
  requestId: string;
  startedAt: number;
  clientIp?: string;
}

export const logContext = new AsyncLocalStorage<LogContext>();

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** ISO-8601 local time with offset, e.g. 2026-10-11T14:03:12.345+07:00 */
export const formatTimestamp = (date: Date) => {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
};

/** `Name: message` followed by the stack frames and causes, like a Java stack trace */
const formatError = (error: Error): string => {
  const frames = (error.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at '));
  const lines = [`${error.name}: ${error.message}`, ...frames];
  if (error.cause instanceof Error) lines.push(`Caused by: ${formatError(error.cause)}`);
  return lines.join('\n');
};

const formatArg = (arg: unknown) => {
  if (arg instanceof Error) return formatError(arg);
  if (typeof arg === 'string') return arg;
  // Keep log records on one line
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return Bun.inspect(arg, { depth: 2 }).replace(/\s*\n\s*/g, ' ');
  }
};

export interface Logger {
  trace: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  isEnabled: (level: LogLevel) => boolean;
}

/** Get a named logger, like `LoggerFactory.getLogger(Foo.class)` */
export const getLogger = (name: string): Logger => {
  const isEnabled = (level: LogLevel) =>
    level !== 'OFF' && SEVERITY[level] >= SEVERITY[options.level];

  const log =
    (level: LogLevel) =>
    (message: string, ...args: unknown[]) => {
      if (!isEnabled(level)) return;

      const thread = logContext.getStore()?.requestId ?? 'main';
      // Errors go on the following lines like a Java stack trace
      const errors = args.filter((arg) => arg instanceof Error);
      const extras = args.filter((arg) => !(arg instanceof Error)).map(formatArg);
      const text = [message, ...extras].join(' ');

      const c = options.color;
      const line =
        `${c ? FAINT : ''}${formatTimestamp(new Date())}${c ? RESET : ''} ` +
        `${c ? LEVEL_COLOR[level] : ''}${level.padStart(5)}${c ? RESET : ''} ` +
        `${c ? MAGENTA : ''}${process.pid}${c ? RESET : ''} ` +
        `${c ? FAINT : ''}--- [${options.appName}] [${thread.padStart(8)}]${c ? RESET : ''} ` +
        `${c ? CYAN : ''}${name.padEnd(16)}${c ? RESET : ''} : ${text}`;

      options.write(
        [line, ...errors.map(formatArg)].join('\n'),
        level,
      );
    };

  return {
    trace: log('TRACE'),
    debug: log('DEBUG'),
    info: log('INFO'),
    warn: log('WARN'),
    error: log('ERROR'),
    isEnabled,
  };
};
