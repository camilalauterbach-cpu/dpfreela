import { useEffect, useRef } from "react";
import {
  useMutation,
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { beginMutation, endMutation } from "@/lib/app-activity";
import { formatSupabaseError, formatSupabaseErrorForUser } from "@/lib/format-error";

interface FeedbackOptions {
  /** Toast shown while the mutation is in flight. Set to `null` to disable. */
  pendingMessage?: string | null;
  /** Toast shown after success. Set to `null` to disable. */
  successMessage?: string | null;
  /** Prefix for the error toast title. */
  errorTitle?: string;
}

/**
 * Wrapper around `useMutation` with three guarantees on top of the raw hook:
 *
 * 1. Concurrency lock: an internal `useRef` blocks a second `mutate()` call
 *    that happens between the first click and the next React render, which
 *    `mutation.isPending` cannot catch because state updates are async.
 * 2. Activity tracking: every in-flight mutation is registered with a unique
 *    ID in the app-activity tracker so reload/beforeunload guards know work
 *    is happening. Released in a `finally`-like block that runs even when a
 *    caller-provided callback throws.
 * 3. Persistent feedback: a "Salvando…" toast is shown until the mutation
 *    settles. Success/error toasts replace it. The user always sees an
 *    outcome — no more silent successes or silent failures.
 */
export function useMutationWithFeedback<TData, TError, TVariables, TContext>(
  options: UseMutationOptions<TData, TError, TVariables, TContext> & FeedbackOptions
): UseMutationResult<TData, TError, TVariables, TContext> & {
  /** True while at least one mutation is in flight (synchronous lock). */
  isLocked: () => boolean;
} {
  const {
    pendingMessage = "Salvando…",
    successMessage = "Alterações salvas.",
    errorTitle = "Não foi possível salvar",
    onMutate,
    onSuccess,
    onError,
    onSettled,
    mutationFn,
    ...rest
  } = options;

  // Synchronous lock — the source of truth for "am I already running?".
  // Independent of React state so two very fast clicks cannot both pass.
  const lockRef = useRef(false);
  // Track active op IDs so we can flush them if the component unmounts mid-flight.
  const activeOpsRef = useRef<Set<string>>(new Set());
  // Track live toast IDs so success/error can replace the pending one.
  const toastMapRef = useRef<Map<string, string | number>>(new Map());

  useEffect(() => {
    return () => {
      // Component unmounted while mutations are in flight — release everything
      // to avoid leaking activity slots or leaving orphan toasts.
      activeOpsRef.current.forEach((id) => endMutation(id));
      activeOpsRef.current.clear();
      toastMapRef.current.forEach((tid) => toast.dismiss(tid));
      toastMapRef.current.clear();
      lockRef.current = false;
    };
  }, []);

  const wrappedMutationFn = mutationFn
    ? async (variables: TVariables) => mutationFn(variables)
    : undefined;

  const mutation = useMutation<TData, TError, TVariables, TContext>({
    ...rest,
    mutationFn: wrappedMutationFn,
    onMutate: async (variables) => {
      const opId = beginMutation();
      activeOpsRef.current.add(opId);
      (variables as any).__opId = opId; // stash for onSettled cleanup

      if (pendingMessage) {
        const tid = toast.loading(pendingMessage);
        toastMapRef.current.set(opId, tid);
      }

      // Caller callback is isolated — its failure must not skip cleanup.
      try {
        if (onMutate) return await onMutate(variables);
      } catch (err) {
        // Release the lock/tracker immediately if the user's onMutate blew up.
        lockRef.current = false;
        endMutation(opId);
        activeOpsRef.current.delete(opId);
        const tid = toastMapRef.current.get(opId);
        if (tid !== undefined) {
          toast.dismiss(tid);
          toastMapRef.current.delete(opId);
        }
        throw err;
      }
      return undefined as unknown as TContext;
    },
    onSuccess: async (data, variables, context) => {
      const opId = (variables as any).__opId as string | undefined;
      const tid = opId ? toastMapRef.current.get(opId) : undefined;
      if (successMessage) {
        if (tid !== undefined) toast.success(successMessage, { id: tid });
        else toast.success(successMessage);
      } else if (tid !== undefined) {
        toast.dismiss(tid);
      }
      try {
        if (onSuccess) await onSuccess(data, variables, context);
      } catch (err) {
        // Never let a screen-specific onSuccess swallow the outcome.
        // eslint-disable-next-line no-console
        console.error("[useMutationWithFeedback] onSuccess callback threw:", err);
      }
    },
    onError: async (error, variables, context) => {
      const opId = (variables as any).__opId as string | undefined;
      const tid = opId ? toastMapRef.current.get(opId) : undefined;
      // eslint-disable-next-line no-console
      console.error(`[${errorTitle}]`, formatSupabaseError(error));
      const description = formatSupabaseErrorForUser(error);
      if (tid !== undefined) toast.error(errorTitle, { id: tid, description });
      else toast.error(errorTitle, { description });
      try {
        if (onError) await onError(error, variables, context);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[useMutationWithFeedback] onError callback threw:", err);
      }
    },
    onSettled: async (data, error, variables, context) => {
      const opId = (variables as any).__opId as string | undefined;
      try {
        if (onSettled) await onSettled(data, error, variables, context);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[useMutationWithFeedback] onSettled callback threw:", err);
      } finally {
        // Guaranteed cleanup — the whole point of the wrapper.
        if (opId) {
          endMutation(opId);
          activeOpsRef.current.delete(opId);
          toastMapRef.current.delete(opId);
        }
        lockRef.current = false;
      }
    },
  });

  // Guarded mutate/mutateAsync that respect the sync lock.
  const originalMutate = mutation.mutate;
  const originalMutateAsync = mutation.mutateAsync;

  mutation.mutate = ((variables: TVariables, opts?: any) => {
    if (lockRef.current) {
      // eslint-disable-next-line no-console
      console.warn("[useMutationWithFeedback] ignored duplicate mutate() while locked");
      return;
    }
    lockRef.current = true;
    try {
      return originalMutate(variables, opts);
    } catch (err) {
      lockRef.current = false;
      throw err;
    }
  }) as typeof mutation.mutate;

  mutation.mutateAsync = (async (variables: TVariables, opts?: any) => {
    if (lockRef.current) {
      throw new Error("Operação já em andamento. Aguarde a conclusão antes de tentar novamente.");
    }
    lockRef.current = true;
    try {
      return await originalMutateAsync(variables, opts);
    } catch (err) {
      // onSettled releases the lock in the normal path; only free here if
      // the async call rejected synchronously before onSettled could fire.
      if (lockRef.current) lockRef.current = false;
      throw err;
    }
  }) as typeof mutation.mutateAsync;

  return Object.assign(mutation, {
    isLocked: () => lockRef.current,
  });
}