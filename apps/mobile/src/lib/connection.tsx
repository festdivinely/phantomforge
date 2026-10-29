import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, normalizeUrl, request, type Connection } from './api';
import type { Me } from './types';

/**
 * The server address + owner token, kept in the phone's secure storage
 * (Android Keystore), never in plain storage.
 */
const STORE_KEY = 'pf.connection';

interface Session extends Connection {
  orgId: string;
  orgName: string;
}

interface ConnectionState {
  /** undefined while reading storage, null when not connected. */
  session: Session | null | undefined;
  connect: (url: string, token: string) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Last saved address, so "change address" can keep the token. */
  saved: Connection | null;
}

const Ctx = createContext<ConnectionState | null>(null);

/** Checks the address and token against the server and returns the session. */
async function open(conn: Connection): Promise<Session> {
  const me = await request<Me>(conn, '/api/me');
  const org = me.organizations[0];
  if (!org) throw new ApiError('The server has no organization set up yet.', 500);
  return { ...conn, orgId: org.id, orgName: org.name };
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [saved, setSaved] = useState<Connection | null>(null);

  useEffect(() => {
    void (async () => {
      const raw = await SecureStore.getItemAsync(STORE_KEY).catch(() => null);
      const stored = raw ? (JSON.parse(raw) as Session) : null;
      setSaved(stored ? { url: stored.url, token: stored.token } : null);
      // Open the app straight away with what was saved; screens show a
      // "can't reach" message with a fix if the tunnel address changed.
      setSession(stored);
    })();
  }, []);

  const connect = useCallback(async (rawUrl: string, rawToken: string) => {
    const conn = { url: normalizeUrl(rawUrl), token: rawToken.trim() };
    if (!conn.url || !conn.token) throw new ApiError('Enter both the server address and the token.', 400);
    const next = await open(conn);
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next));
    setSaved(conn);
    setSession(next);
  }, []);

  const disconnect = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORE_KEY);
    setSaved(null);
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, connect, disconnect, saved }), [session, connect, disconnect, saved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): ConnectionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConnection must be used inside ConnectionProvider');
  return ctx;
}

/** For screens behind the connection guard: the session is always present. */
export function useSession() {
  const { session } = useConnection();
  if (!session) throw new Error('useSession used without a connection');
  const call = useCallback(
    <T,>(path: string, init?: { method?: string; body?: unknown }) => request<T>(session, path, init),
    [session],
  );
  return { session, call };
}
