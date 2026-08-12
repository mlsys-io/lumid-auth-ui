import { createContext, useContext } from "react";

/**
 * True for anything rendered INSIDE an app surface.
 *
 * `AppOverview` renders an app's declared surface, and a surface can mount a
 * native that renders `AppOverview` again — `ui/workflows.md` does exactly that
 * via `lumid:native key: app-workflows`. That closes a loop: surface → native →
 * overview → surface, which rendered the Workflows page nested inside itself
 * several levels deep and corrupted the top strip.
 *
 * A depth flag rather than a special case in `AppWorkflowsSurface`: any future
 * native that mounts the overview inherits the guard instead of rediscovering
 * the bug.
 */
export const InAppSurfaceContext = createContext(false);

export const useInAppSurface = () => useContext(InAppSurfaceContext);
