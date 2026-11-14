/** Shared timings for CSS transitions and their JS lifecycle. */
export const motion = {
  feedback: 5000,
  fast: 140,
  exit: 180,
  enter: 260,
  layout: 280,
  ease: 'cubic-bezier(.2,.8,.2,1)',
  spring: 'cubic-bezier(.22,.76,.23,1)',
} as const;

export const motionTokens: Record<string, string> = {
  'motion-fast': `${motion.fast}ms`,
  'motion-exit': `${motion.exit}ms`,
  'motion-enter': `${motion.enter}ms`,
  'motion-layout': `${motion.layout}ms`,
  'motion-ease': motion.ease,
  'motion-spring': motion.spring,
};
