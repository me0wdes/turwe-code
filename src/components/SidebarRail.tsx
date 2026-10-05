import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { fluid } from "../motion";
import { useChatMotion } from "../chat-motion";

export function SidebarRail({
  open,
  motionEnabled,
  children,
}: {
  open: boolean;
  motionEnabled: boolean;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(264);
  const reduced = !useChatMotion() || !motionEnabled;
  useLayoutEffect(() => {
    const sidebar = content.current?.firstElementChild;
    if (!sidebar) return;
    const measure = () => setWidth(sidebar.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div
      id="navigation-sidebar"
      className="sidebar-rail"
      inert={!open}
      aria-hidden={!open}
      initial={false}
      // The rail changes the real workspace bounds, including native browser views.
      animate={{ width: open ? width : 0 }}
      transition={reduced ? { duration: 0 } : fluid.slow}
    >
      <motion.div
        ref={content}
        className="sidebar-content"
        initial={false}
        animate={{
          transform: open || reduced ? "translateX(0px)" : "translateX(-20px)",
          opacity: open ? 1 : 0,
        }}
        transition={reduced ? { duration: 0 } : fluid.slow}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
