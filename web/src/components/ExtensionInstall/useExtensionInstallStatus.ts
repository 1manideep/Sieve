// The extension's state for the signed-in screens (Settings, Setup). The home base engine opens the port to the
// extension only once this tab is the home base, so until then the store says 'off'. When this build has the
// extension (VITE_EXTENSION_ID) that reads as 'idle': the download and the steps still show. 'off' stays 'off',
// and nothing shows, only when the build has no extension.
import { env } from '@/app/env';
import { useHomeBase, type ExtensionStatus } from '@/state/homeBase';

export function installStatus(store: ExtensionStatus, extensionId: string | undefined): ExtensionStatus {
  return store === 'off' && extensionId ? 'idle' : store;
}

export function useExtensionInstallStatus(extensionId: string | undefined = env.extensionId): ExtensionStatus {
  return installStatus(
    useHomeBase((s) => s.extension),
    extensionId,
  );
}
