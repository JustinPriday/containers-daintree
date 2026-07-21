import { useCallback, useEffect, useRef, useState } from "react";

interface PluginHostBridge {
  invoke(pluginId: string, channel: string, ...args: unknown[]): Promise<unknown>;
  onPanel(
    pluginId: string,
    channel: string,
    panelId: string,
    callback: (payload: unknown) => void
  ): () => void;
}

interface PluginBridgeGlobal {
  electron?: { plugin?: PluginHostBridge };
}

interface HostChannelResult<TArgs, TResult> {
  invoke(args: TArgs): Promise<TResult | undefined>;
  loading: boolean;
  error: Error | null;
}

function getPluginHostBridge(): PluginHostBridge {
  const bridge = (globalThis as unknown as PluginBridgeGlobal).electron?.plugin;
  if (!bridge) {
    throw new Error("Daintree's plugin renderer bridge is unavailable.");
  }
  return bridge;
}

/**
 * Compatibility implementation of Daintree's public hook contract.
 *
 * Daintree 0.27's published plugin-sdk/react entry embeds a Node-oriented
 * React runtime. Keeping this small adapter in the plugin lets Vite externalize
 * every React import to the host facade until the SDK package is corrected.
 */
export function useHostChannel<TArgs = unknown, TResult = unknown>(
  pluginId: string,
  channel: string
): HostChannelResult<TArgs, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const callIdRef = useRef(0);

  useEffect(() => {
    setLoading(false);
    setError(null);
  }, [pluginId, channel]);

  const invoke = useCallback(
    async (args: TArgs): Promise<TResult | undefined> => {
      const callId = ++callIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = (await getPluginHostBridge().invoke(pluginId, channel, args)) as TResult;
        return callId === callIdRef.current ? result : undefined;
      } catch (cause) {
        if (callId !== callIdRef.current) return undefined;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        return undefined;
      } finally {
        if (callId === callIdRef.current) setLoading(false);
      }
    },
    [pluginId, channel]
  );

  return { invoke, loading, error };
}

export function usePluginPanelEvent<TPayload = unknown>(
  pluginId: string,
  channel: string,
  panelId: string,
  handler: (payload: TPayload) => void
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(
    () =>
      getPluginHostBridge().onPanel(pluginId, channel, panelId, (payload) => {
        handlerRef.current(payload as TPayload);
      }),
    [pluginId, channel, panelId]
  );
}
