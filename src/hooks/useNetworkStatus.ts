import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { networkStateAtom } from '../atoms/networkAtom';
import { syncEngine } from '../sync/syncEngine';

export function useNetworkStatus() {
  const [networkState, setNetworkState] = useAtom(networkStateAtom);

  useEffect(() => {
    const unsubscribe = syncEngine.subscribe((status, pendingCount) => {
      setNetworkState({ status, pendingCount });
    });

    return unsubscribe;
  }, [setNetworkState]);

  return {
    status: networkState.status,
    pendingCount: networkState.pendingCount,
    isOnline: networkState.status === 'ONLINE',
    isOffline: networkState.status === 'OFFLINE',
    isSyncing: networkState.status === 'SYNCING',
    hasError: networkState.status === 'ERROR',
    forceSync: () => syncEngine.forceSync(),
  };
}
