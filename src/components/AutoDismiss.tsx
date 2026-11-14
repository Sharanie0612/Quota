import { useEffect, useState, type ReactNode } from 'react';
import { motion } from '../lib/motion';

/** Mount with a new key for a new result; polling the same result must not restart it. */
export function AutoDismiss({children}: {children: (dismiss: () => void) => ReactNode}) {
  const [phase, setPhase] = useState<'visible' | 'leaving' | 'hidden'>('visible');
  useEffect(() => {
    if (phase === 'hidden') return;
    const timer = window.setTimeout(() => setPhase(phase === 'visible' ? 'leaving' : 'hidden'),
      phase === 'visible' ? motion.feedback : motion.exit);
    return () => window.clearTimeout(timer);
  }, [phase]);
  if (phase === 'hidden') return null;
  return <div className="notice-presence" data-leaving={phase === 'leaving'}>
    <div className="notice-presence-inner">{children(() => setPhase('leaving'))}</div>
  </div>;
}
