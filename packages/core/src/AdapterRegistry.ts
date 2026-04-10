import type { BaseAdapter } from "./index.js";

// Adapters are imported and registered here.
// Order matters: more specific adapters first, GenericAdapter always last.
// We use dynamic imports to keep core lightweight.

// Lazy load: we check canHandle without importing the full module.
// In production, each adapter registers itself via a side-effect import.
// For now, we use a simpler approach:

let adapterCache: Array<new () => BaseAdapter> | null = null;

async function loadAdapters(): Promise<Array<new () => BaseAdapter>> {
  if (adapterCache) return adapterCache;

  const adapters: Array<new () => BaseAdapter> = [];

  // Try loading each adapter package
  const knownAdapters = [
    { module: "@fangai/pi", exportName: "PiAdapter" },
    { module: "@fangai/adapter-aider", exportName: "AiderAdapter" },
    { module: "@fangai/adapter-claude", exportName: "ClaudeAdapter" },
    { module: "@fangai/adapter-codex", exportName: "CodexAdapter" },
    { module: "@fangai/adapter-opencode", exportName: "OpenCodeAdapter" },
    { module: "@fangai/adapter-generic", exportName: "GenericAdapter" },
  ];

  const loadFailures: string[] = [];

  for (const { module, exportName } of knownAdapters) {
    try {
      const mod = await import(module);
      const Ctor = mod[exportName] as new () => BaseAdapter;
      if (!Ctor) {
        loadFailures.push(`${module} (missing export ${exportName})`);
        continue;
      }
      adapters.push(Ctor);
    } catch {
      loadFailures.push(module);
    }
  }

  if (
    loadFailures.length > 0 &&
    process.env.FANG_SILENT_ADAPTER_LOAD !== "1" &&
    process.env.VITEST !== "true"
  ) {
    console.warn(
      `[fang] Optional adapter packages not loaded: ${loadFailures.join(", ")}. ` +
        `Install missing @fangai/* packages if you need them. Set FANG_SILENT_ADAPTER_LOAD=1 to hide this.`
    );
  }

  adapterCache = adapters;
  return adapters;
}

/**
 * Auto-detect which adapter to use for the given CLI command.
 * Returns a new instance of the matching adapter, or GenericAdapter as fallback.
 */
export async function detectAdapter(cli: string): Promise<BaseAdapter> {
  const adapters = await loadAdapters();

  type AdapterCtor = new () => BaseAdapter;
  type WithCanHandle = AdapterCtor & { canHandle: (cli: string) => boolean };

  for (const Adapter of adapters) {
    if ((Adapter as WithCanHandle).canHandle(cli)) {
      return new Adapter();
    }
  }

  // Fallback: try GenericAdapter (dynamic path keeps core free of a static adapter dependency)
  try {
    const { GenericAdapter } = await import(
      // resolved at runtime when the workspace adapter package is present
      "@fangai/adapter-generic" as string
    );
    return new GenericAdapter();
  } catch {
    throw new Error(
      `No adapter found for "${cli}" and GenericAdapter not available. ` +
        `Install @fangai/adapter-generic or write a custom adapter.`
    );
  }
}
