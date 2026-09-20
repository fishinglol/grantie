/// <reference types="vite/client" />

// Typed names for the two build-time variables this app reads. `vite/client`
// already declares ImportMetaEnv; this just documents ours.
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_CLIENT_SECRET?: string;
}
