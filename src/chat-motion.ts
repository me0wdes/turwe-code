import { useContext, useSyncExternalStore } from "react";
import { MotionConfigContext } from "motion/react";

const preference = typeof window === "undefined"
  ? null
  : window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribe = (changed: () => void) => {
  preference?.addEventListener("change", changed);
  return () => preference?.removeEventListener("change", changed);
};
const getSnapshot = () => preference?.matches ?? false;

// Height animations need the same preference as transform animations.
export function useChatMotion() {
  const { reducedMotion, skipAnimations } = useContext(MotionConfigContext);
  const systemReduced = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return !skipAnimations && reducedMotion !== "always" && !systemReduced;
}
