import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

type PutOptions = {
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
};

type GetOptions = {
  range?: {
    offset: number;
    length: number;
  };
};

export type PrivateStoredObject = {
  body: Uint8Array;
  size: number;
};

function storageRoot() {
  const configured = process.env.PRIVATE_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'storage', 'private');
}

function safePath(key: string) {
  const normalized = key.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('Invalid private storage key');
  }
  const root = storageRoot();
  const resolved = path.resolve(root, ...normalized.split('/'));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Private storage key escapes the storage root');
  }
  return resolved;
}

async function bodyBytes(body: BodyInit | ReadableStream<Uint8Array>) {
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

async function listFiles(directory: string, root: string): Promise<Array<{ key: string }>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const objects: Array<{ key: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      objects.push(...(await listFiles(fullPath, root)));
    } else if (entry.isFile()) {
      objects.push({ key: path.relative(root, fullPath).split(path.sep).join('/') });
    }
  }
  return objects;
}

export class PrivateStorage {
  async put(
    key: string,
    body: BodyInit | ReadableStream<Uint8Array>,
    options?: PutOptions
  ) {
    void options;
    const destination = safePath(key);
    await mkdir(path.dirname(destination), { recursive: true });
    const bytes = await bodyBytes(body);
    await writeFile(destination, bytes, { flag: 'wx' });
    return { key, size: bytes.byteLength };
  }

  async get(key: string, options?: GetOptions): Promise<PrivateStoredObject | null> {
    const source = safePath(key);
    const bytes = await readFile(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!bytes) return null;
    if (options?.range) {
      const start = options.range.offset;
      const end = start + options.range.length;
      const slice = bytes.subarray(start, end);
      return { body: slice, size: slice.byteLength };
    }
    return { body: bytes, size: bytes.byteLength };
  }

  async head(key: string) {
    const metadata = await stat(safePath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    return metadata ? { key, size: metadata.size } : null;
  }

  async delete(key: string) {
    await rm(safePath(key), { force: true });
  }

  async list({ cursor, limit = 1000 }: { cursor?: string; limit?: number } = {}) {
    const root = storageRoot();
    await mkdir(root, { recursive: true });
    const all = (await listFiles(root, root)).sort((left, right) => left.key.localeCompare(right.key));
    const offset = cursor ? Number(cursor) || 0 : 0;
    const objects = all.slice(offset, offset + limit);
    const nextOffset = offset + objects.length;
    return {
      objects,
      truncated: nextOffset < all.length,
      cursor: nextOffset < all.length ? String(nextOffset) : undefined,
    };
  }
}

const globalStorage = globalThis as typeof globalThis & {
  __ENGLIZEKA_PRIVATE_STORAGE__?: PrivateStorage;
};

export function getPrivateStorage() {
  globalStorage.__ENGLIZEKA_PRIVATE_STORAGE__ ??= new PrivateStorage();
  return globalStorage.__ENGLIZEKA_PRIVATE_STORAGE__;
}
