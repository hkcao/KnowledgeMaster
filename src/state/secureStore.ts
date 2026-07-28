import { Stronghold } from "@tauri-apps/plugin-stronghold";
import { appDataDir } from "@tauri-apps/api/path";

const API_KEY_RECORD = "api_key";
const CLIENT_NAME = "knowledge-master";

async function openStronghold() {
  const vaultPath = `${await appDataDir()}/vault.hold`;
  // Note: in this pass we use an app-specific password. A future hardening
  // pass should derive this from the OS keychain or user credentials.
  const vaultPassword = "knowledge-master-vault";
  const stronghold = await Stronghold.load(vaultPath, vaultPassword);
  try {
    const client = await stronghold.loadClient(CLIENT_NAME);
    return { stronghold, client };
  } catch {
    const client = await stronghold.createClient(CLIENT_NAME);
    return { stronghold, client };
  }
}

export async function loadApiKey(): Promise<string | null> {
  try {
    const { stronghold, client } = await openStronghold();
    const store = client.getStore();
    const data = await store.get(API_KEY_RECORD);
    await stronghold.save();
    return data ? new TextDecoder().decode(new Uint8Array(data)) : null;
  } catch {
    return null;
  }
}

export async function saveApiKey(key: string): Promise<void> {
  const { stronghold, client } = await openStronghold();
  const store = client.getStore();
  await store.insert(API_KEY_RECORD, Array.from(new TextEncoder().encode(key)));
  await stronghold.save();
}
