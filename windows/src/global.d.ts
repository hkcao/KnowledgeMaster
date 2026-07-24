import type { KnowledgeMasterAPI } from "./types";

declare global {
  interface Window {
    km: KnowledgeMasterAPI;
  }
}

export {};
