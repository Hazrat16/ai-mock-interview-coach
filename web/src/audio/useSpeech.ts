import { useSyncExternalStore } from 'react';
import { player } from './player';

/** The shared player's state (idle, speaking, blocked, error) for rendering. */
export const usePlayerState = () => useSyncExternalStore(player.subscribe, player.getState);
