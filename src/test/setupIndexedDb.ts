// Install fake IndexedDB before any test module graph loads Dexie (Bun may evaluate dexie first).
import 'fake-indexeddb/auto';
