import { atom } from 'jotai';
import { NetworkStatus } from '../types';

export interface NetworkStateInfo {
  status: NetworkStatus;
  pendingCount: number;
}

export const networkStateAtom = atom<NetworkStateInfo>({
  status: 'ONLINE',
  pendingCount: 0,
});
