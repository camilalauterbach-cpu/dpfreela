import { useEffect, useId, useRef } from "react";
import { markFormClean, markFormDirty } from "@/lib/app-activity";

/**
 * Registers a form as "dirty" in the app-wide activity tracker while
 * `isDirty` is true, and cleans up on unmount so a killed form never leaves
 * a stale entry behind.
 *
 * Usage:
 *   const { formState: { isDirty }, reset, handleSubmit } = useForm(...);
 *   useUnsavedFormGuard(isDirty);
 *
 * After a successful save the form MUST call `reset(persistedValues)` so
 * React Hook Form clears `isDirty` — otherwise the guard will keep blocking
 * navigation as if the user still had unsaved changes.
 */
export function useUnsavedFormGuard(isDirty: boolean, explicitId?: string) {
  const autoId = useId();
  const idRef = useRef(explicitId ?? `form-${autoId}`);

  useEffect(() => {
    const id = idRef.current;
    if (isDirty) {
      markFormDirty(id);
    } else {
      markFormClean(id);
    }
  }, [isDirty]);

  // Always release the slot on unmount, even if isDirty was true at the time.
  useEffect(() => {
    const id = idRef.current;
    return () => {
      markFormClean(id);
    };
  }, []);
}