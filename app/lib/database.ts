import { Pool, types, type QueryResultRow } from 'pg';

types.setTypeParser(20, (value) => Number(value));

export type DatabaseValue = string | number | boolean | null | undefined | Uint8Array;

export type DatabaseResult<T = Record<string, unknown>> = {
  results: T[];
  success: true;
  meta: {
    changes: number;
  };
};

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error('DATABASE_URL is required');
  }
  return value;
}

function quoteCamelCaseAliases(sql: string) {
  return sql.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi, (match, alias: string) =>
    /[A-Z]/.test(alias) ? `AS "${alias}"` : match
  );
}

function postgresSql(sql: string) {
  let parameter = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let output = '';

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (character === "'" && !doubleQuoted) {
      output += character;
      if (singleQuoted && next === "'") {
        output += next;
        index += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
      continue;
    }
    if (character === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      output += character;
      continue;
    }
    if (character === '?' && !singleQuoted && !doubleQuoted) {
      parameter += 1;
      output += `$${parameter}`;
      continue;
    }
    output += character;
  }

  return quoteCamelCaseAliases(output);
}

function normalizeValue(value: DatabaseValue) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
}

export class PreparedStatement {
  readonly sql: string;
  readonly values: DatabaseValue[];
  private readonly database: Database;

  constructor(database: Database, sql: string, values: DatabaseValue[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: DatabaseValue[]) {
    return new PreparedStatement(this.database, this.sql, values);
  }

  async first<T extends QueryResultRow = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.database.query<T>(this.sql, this.values);
    return result.rows[0] ?? null;
  }

  async all<T extends QueryResultRow = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const result = await this.database.query<T>(this.sql, this.values);
    return {
      results: result.rows,
      success: true,
      meta: { changes: result.rowCount ?? 0 },
    };
  }

  async run<T extends QueryResultRow = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const result = await this.database.query<T>(this.sql, this.values);
    return {
      results: result.rows,
      success: true,
      meta: { changes: result.rowCount ?? 0 },
    };
  }
}

export class Database {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  prepare(sql: string) {
    return new PreparedStatement(this, sql);
  }

  async query<T extends QueryResultRow>(sql: string, values: DatabaseValue[] = []) {
    return this.pool.query<T>(postgresSql(sql), values.map(normalizeValue));
  }

  async batch(statements: PreparedStatement[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: DatabaseResult[] = [];
      for (const statement of statements) {
        const result = await client.query(
          postgresSql(statement.sql),
          statement.values.map(normalizeValue)
        );
        results.push({
          results: result.rows,
          success: true,
          meta: { changes: result.rowCount ?? 0 },
        });
      }
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async readBatch(statements: PreparedStatement[]) {
    const client = await this.pool.connect();
    try {
      const results: DatabaseResult[] = [];
      for (const statement of statements) {
        const result = await client.query(
          postgresSql(statement.sql),
          statement.values.map(normalizeValue)
        );
        results.push({
          results: result.rows,
          success: true,
          meta: { changes: result.rowCount ?? 0 },
        });
      }
      return results;
    } finally {
      client.release();
    }
  }
}

const globalDatabase = globalThis as typeof globalThis & {
  __ENGLIZEKA_DATABASE_POOL__?: Pool;
  __ENGLIZEKA_DATABASE__?: Database;
};

export function getDatabase() {
  if (!globalDatabase.__ENGLIZEKA_DATABASE_POOL__) {
    const requestedMax = Number(process.env.DATABASE_POOL_MAX || 20);
    globalDatabase.__ENGLIZEKA_DATABASE_POOL__ = new Pool({
      connectionString: databaseUrl(),
      max: Number.isFinite(requestedMax) ? Math.min(Math.max(Math.round(requestedMax), 2), 50) : 20,
      keepAlive: true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  if (
    !globalDatabase.__ENGLIZEKA_DATABASE__ ||
    typeof globalDatabase.__ENGLIZEKA_DATABASE__.readBatch !== 'function'
  ) {
    globalDatabase.__ENGLIZEKA_DATABASE__ = new Database(globalDatabase.__ENGLIZEKA_DATABASE_POOL__);
  }
  return globalDatabase.__ENGLIZEKA_DATABASE__;
}
