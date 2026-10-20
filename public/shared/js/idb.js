const DB_NAME = "pathfinder_offline";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache")) {
        db.createObjectStore("cache", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export const idb = {
  async cacheSet(key, value) {
    await withStore("cache", "readwrite", (store) => store.put({ key, value, savedAt: Date.now() }));
  },
  async cacheGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("cache", "readonly");
      const req = tx.objectStore("cache").get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  },
  async outboxAdd(entry) {
    await withStore("outbox", "readwrite", (store) => store.add(entry));
  },
  async outboxAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("outbox", "readonly");
      const req = tx.objectStore("outbox").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async outboxRemove(id) {
    await withStore("outbox", "readwrite", (store) => store.delete(id));
  },
};
