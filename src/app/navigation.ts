import { motion } from './runtime';
import { syncTimelineUrl } from './app';
import { openEntity } from '../site/context';

export function openTimelineEntity(kind: 'person' | 'event', id: string): void {
  document.dispatchEvent(new CustomEvent('lantai:flush-view'));
  motion.dragging = false;
  syncTimelineUrl();
  openEntity(kind, id);
}
