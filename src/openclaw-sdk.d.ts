// Type declarations for OpenClaw plugin SDK
// These types are provided by the OpenClaw runtime at runtime

declare module 'openclaw/plugin-sdk/plugin-entry' {
  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    kind?: string;
    init?: (config: any) => Promise<void>;
    register: (api: any) => void | Promise<void>;
    dispose?: () => Promise<void>;
  }): any;
}

declare module 'openclaw/plugin-sdk/runtime-store' {
  export function createPluginRuntimeStore(): any;
}
