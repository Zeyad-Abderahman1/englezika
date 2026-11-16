import type { Database } from '../database';
import type { PrivateStorage } from '../private-storage';

export class DomainError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
  }
}

export interface ServiceContext {
  db?: Database;
  metadataDb?: Database;
  afterCommit?: Array<() => Promise<void> | void>;
  storage?: PrivateStorage;
  request?: Request;
}

export interface OperatorIdentity {
  email: string;
  name?: string;
  role?: string;
}
