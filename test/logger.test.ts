import { beforeEach, describe, expect, it } from 'bun:test';

import { configureLogger, formatTimestamp, getLogger, logContext, parseLogLevel } from '../src/logger.ts';

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  configureLogger({ level: 'INFO', color: false, write: (line) => logs.push(line) });
});

describe('logger', () => {
  it('writes Spring Boot style lines', () => {
    getLogger('test.logger').info('hello', { a: 1 });
    expect(logs[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} {2}INFO \d+ --- \[bill-please-mcp\] \[ {4}main\] test\.logger {6}: hello \{"a":1\}$/,
    );
  });

  it('filters by level', () => {
    const log = getLogger('test');
    log.debug('hidden');
    log.warn('shown');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(' WARN ');

    configureLogger({ level: 'OFF' });
    log.error('also hidden');
    expect(logs).toHaveLength(1);
  });

  it('shows the request id from the log context', () => {
    logContext.run({ requestId: 'abcd1234', startedAt: 0 }, () => getLogger('test').info('in request'));
    expect(logs[0]).toContain('[abcd1234] test');
  });

  it('prints errors with message, stack and cause', () => {
    const error = new Error('outer', { cause: new TypeError('inner') });
    getLogger('test').error('failed', error);
    const [line, ...trace] = logs[0]!.split('\n');
    expect(line).toEndWith(': failed');
    expect(trace[0]).toBe('Error: outer');
    expect(trace.some((l) => l.trimStart().startsWith('at '))).toBe(true);
    expect(trace.some((l) => l.startsWith('Caused by: TypeError: inner'))).toBe(true);
  });

  it('parses LOG_LEVEL case-insensitively with a fallback', () => {
    expect(parseLogLevel('debug')).toBe('DEBUG');
    expect(parseLogLevel(' Warn ')).toBe('WARN');
    expect(parseLogLevel('verbose')).toBe('INFO');
    expect(parseLogLevel(undefined, 'ERROR')).toBe('ERROR');
  });

  it('formats timestamps with the local offset', () => {
    expect(formatTimestamp(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  });
});
