import { clearPersistedSession } from './cachedSession';

/** Authentication only: device sales, catalog and metadata must survive sign-out. */
export async function signOutSession(reachable: boolean, localSignOut: () => Promise<{ error: unknown }>) {
  if (reachable) {
    const { error } = await localSignOut();
    if (error) throw error;
  }
  clearPersistedSession();
}