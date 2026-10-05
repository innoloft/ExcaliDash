import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

/**
 * Mounts a hook in a throwaway component, the way the editor tests do, so hook
 * tests run in the plain node environment without a DOM.
 */
export const renderHook = async <P, R>(
  hook: (props: P) => R,
  initialProps?: P,
) => {
  const result = { current: undefined as unknown as R };
  const Harness = ({ hookProps }: { hookProps: P }) => {
    result.current = hook(hookProps);
    return null;
  };
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<Harness hookProps={initialProps as P} />);
  });
  return {
    result,
    rerender: (props: P) =>
      act(async () => {
        renderer?.update(<Harness hookProps={props} />);
      }),
    unmount: () =>
      act(async () => {
        renderer?.unmount();
      }),
  };
};

/** Retries an assertion while letting pending effects and promises settle. */
export const waitFor = async (assertion: () => void, timeoutMs = 1000) => {
  const startedAt = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) throw error;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
};
