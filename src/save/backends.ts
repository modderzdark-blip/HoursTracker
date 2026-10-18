/** Key/value string storage. Saves are serialised JSON. */
export interface StorageBackend {
  readonly name: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryBackend implements StorageBackend {
  readonly name = 'memory';
  private readonly data = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

export class LocalStorageBackend implements StorageBackend {
  readonly name = 'localStorage';

  constructor(
    private readonly storage: Storage,
    private readonly prefix = 'ashbound:',
  ) {}

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.storage.getItem(this.prefix + key));
  }

  set(key: string, value: string): Promise<void> {
    this.storage.setItem(this.prefix + key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.storage.removeItem(this.prefix + key);
    return Promise.resolve();
  }
}

const DB_NAME = 'ashbound';
const STORE = 'kv';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDBBackend implements StorageBackend {
  readonly name = 'indexedDB';

  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory, dbName = DB_NAME): Promise<IndexedDBBackend> {
    const req = factory.open(dbName, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    const db = await request(req);
    return new IndexedDBBackend(db);
  }

  async get(key: string): Promise<string | null> {
    const tx = this.db.transaction(STORE, 'readonly');
    const value: unknown = await request(tx.objectStore(STORE).get(key));
    return typeof value === 'string' ? value : null;
  }

  async set(key: string, value: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  }

  async remove(key: string): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
  }

  close(): void {
    this.db.close();
  }
}

/** IndexedDB → localStorage → memory, whichever works first on this device. */
export async function createBestBackend(): Promise<StorageBackend> {
  if (typeof indexedDB !== 'undefined') {
    try {
      return await IndexedDBBackend.open(indexedDB);
    } catch (err) {
      console.warn('[save] IndexedDB unavailable, falling back to localStorage', err);
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__ashbound_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return new LocalStorageBackend(localStorage);
    }
  } catch (err) {
    console.warn('[save] localStorage unavailable, progress will not persist', err);
  }
  return new MemoryBackend();
}
