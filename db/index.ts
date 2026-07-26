import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { getD1 } from '../app/lib/platform';

export function getDb() {
  return drizzle(getD1(), { schema });
}
