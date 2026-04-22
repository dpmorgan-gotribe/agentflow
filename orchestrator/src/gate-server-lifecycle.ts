/**
 * Gate-server lifecycle stub. Task-036 will replace this with a real
 * ephemeral HTTP server bound to a dynamic port for gates 2 + 4
 * (mockups + signoff) + a file-watcher for file-drop gates (1 + 3 + 5
 * + 6). For now the stub returns a fake base URL so the orchestrator
 * can exercise its env-plumbing (CLAUDE_GATE_API_BASE) end-to-end
 * without blocking on task-036.
 *
 * When task-036 lands, replace the body of `startGateServer` with:
 *   - spawn http server on dynamic port
 *   - mount POST /api/dials/:styleId, POST /api/select, POST /api/signoff
 *   - return { baseUrl: `http://localhost:${port}`, stop }
 *
 * The public interface stays the same — callers don't need to change.
 */

export interface GateServerHandle {
  baseUrl: string | null;
  stop: () => Promise<void>;
  /** Which stage the server was started for (diagnostic). */
  stageName: string;
}

export async function startGateServer(args: {
  stageName: string;
  projectRoot: string;
}): Promise<GateServerHandle> {
  // eslint-disable-next-line no-console
  console.log(
    `[gate-server-stub] stage=${args.stageName} — task-036 HTTP server not yet shipped; using file-drop placeholder. ` +
      `CLAUDE_GATE_API_BASE will be null for this stage.`,
  );
  return {
    baseUrl: null,
    stageName: args.stageName,
    stop: async () => {
      // no-op until task-036 wires a real server
    },
  };
}
