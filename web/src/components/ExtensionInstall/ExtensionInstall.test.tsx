// Getting the extension: the zip link with the version, the steps and when they are open, the Copy button for
// chrome://extensions (copied, or selected when the clipboard is blocked), the Chrome Web Store variant, the hidden
// case, and the signed-in status mapping. Exact copy, with axe.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXTENSION_INSTALL, fillText } from '@/copy/screens-controls';
import { useAnnouncer } from '@/state/announcer';
import type { ExtensionStatus } from '@/state/homeBase';
import { expectNoAxeViolations } from '@/test/axe';
import { EXTENSIONS_ADDRESS, EXTENSION_ZIP_URL, ExtensionInstall, zipLinkLabel } from './ExtensionInstall';
import { installStatus } from './useExtensionInstallStatus';

const STORE = 'https://chromewebstore.google.com/detail/sieve/abcdefghijklmnopabcdefghijklmnop';
const zipLabel = zipLinkLabel();
/** The label as read: its no-break spaces as spaces. */
const plain = (s: string) => s.replaceAll('\u00a0', ' ');
const howTo = () => screen.getByRole('button', { name: EXTENSION_INSTALL.howTo });
const steps = () => screen.getByRole('list', { hidden: true });

function show(status: ExtensionStatus, storeUrl?: string) {
  return render(
    <main>
      <ExtensionInstall status={status} storeUrl={storeUrl} />
    </main>,
  );
}

/** Flush the announcer's next-frame write. */
async function announced(): Promise<string> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  return useAnnouncer.getState().polite;
}

afterEach(() => {
  useAnnouncer.setState({ polite: '', assertive: '' });
  vi.restoreAllMocks();
});

describe('ExtensionInstall', () => {
  it('links the zip of this version, to download, as the main button', async () => {
    show('not-installed');
    const link = screen.getByRole('link', { name: zipLabel });
    expect(plain(zipLabel)).toBe('Download the extension (version 0.0.0-test, .zip)');
    expect(plain(zipLabel)).toBe(fillText(EXTENSION_INSTALL.download, { version: '0.0.0-test' }));
    expect(zipLabel).toBe('Download the extension (version\u00a00.0.0-test,\u00a0.zip)');   // the parenthesis never splits
    expect(link).toHaveAttribute('href', '/downloads/sieve-extension-0.0.0-test.zip');
    expect(EXTENSION_ZIP_URL).toBe('/downloads/sieve-extension-0.0.0-test.zip');
    expect(link).toHaveAttribute('download');
    expect(link).not.toHaveAttribute('target');
    expect(link.className).toMatch(/primary/);
    await expectNoAxeViolations();
  });

  it('shows the six steps, the warning and how to update while not installed', async () => {
    show('not-installed');
    expect(howTo()).toHaveAttribute('aria-expanded', 'true');
    const list = steps();
    expect(document.getElementById(howTo().getAttribute('aria-controls') ?? '')).toContainElement(list);
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent(EXTENSION_INSTALL.step1);
    expect(items[1]).toHaveTextContent(`${EXTENSION_INSTALL.step2}${EXTENSION_INSTALL.step2Note}`);
    expect(items[2]).toHaveTextContent(EXTENSION_INSTALL.step3);
    expect(items[2]).toHaveTextContent(EXTENSIONS_ADDRESS);
    expect(items[3]).toHaveTextContent(EXTENSION_INSTALL.step4);
    expect(items[4]).toHaveTextContent('Click Load unpacked and choose the unzipped folder, the one that contains manifest.json.');
    expect(items[5]).toHaveTextContent(EXTENSION_INSTALL.step6);
    expect(screen.getByText(EXTENSION_INSTALL.warning)).toBeVisible();
    expect(screen.getByText(/^To update: download the new zip/)).toHaveTextContent(
      "To update: download the new zip, replace the folder's contents, then press the reload arrow on Sieve's card in chrome://extensions.",
    );
    await expectNoAxeViolations();
  });

  it('folds the steps once connected; How to install opens and closes them', async () => {
    const user = userEvent.setup();
    show('connected');
    expect(screen.getByRole('link', { name: zipLabel }).className).toMatch(/secondary/);
    expect(howTo()).toHaveAttribute('aria-expanded', 'false');
    expect(steps()).not.toBeVisible();
    await user.click(howTo());
    expect(howTo()).toHaveAttribute('aria-expanded', 'true');
    expect(steps()).toBeVisible();
    await expectNoAxeViolations();
    await user.click(howTo());
    expect(steps()).not.toBeVisible();
  });

  it('keeps the person\'s choice when the state changes', async () => {
    const user = userEvent.setup();
    const { rerender } = show('connecting');
    expect(howTo()).toHaveAttribute('aria-expanded', 'false');
    rerender(<main><ExtensionInstall status="not-installed" /></main>);
    expect(howTo()).toHaveAttribute('aria-expanded', 'true');    // follows the state until pressed
    await user.click(howTo());
    rerender(<main><ExtensionInstall status="idle" /></main>);
    expect(howTo()).toHaveAttribute('aria-expanded', 'false');
  });

  it('copies chrome://extensions and confirms it in place and to screen readers', async () => {
    const user = userEvent.setup();
    show('not-installed');
    const copy = screen.getByRole('button', { name: EXTENSION_INSTALL.copyLabel });
    expect(copy).toHaveTextContent(EXTENSION_INSTALL.copy);
    await user.click(copy);
    expect(await navigator.clipboard.readText()).toBe('chrome://extensions');
    expect(screen.getByRole('button', { name: EXTENSION_INSTALL.copied })).toBeInTheDocument();
    expect(await announced()).toBe(EXTENSION_INSTALL.addressCopied);
    await expectNoAxeViolations();
  });

  it('selects the address and says so when the clipboard is blocked', async () => {
    const user = userEvent.setup();
    show('not-installed');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('blocked'));
    await user.click(screen.getByRole('button', { name: EXTENSION_INSTALL.copyLabel }));
    expect(await announced()).toBe(EXTENSION_INSTALL.copyFailed);
    expect(window.getSelection()?.toString()).toBe('chrome://extensions');
    expect(screen.getByRole('button', { name: EXTENSION_INSTALL.copyLabel })).toBeInTheDocument();
  });

  it('with a Chrome Web Store page: the store leads, the zip is "Or load it unpacked", the steps folded', async () => {
    show('not-installed', STORE);
    const store = screen.getByRole('link', { name: EXTENSION_INSTALL.store });
    expect(store).toHaveAttribute('href', STORE);
    expect(store).toHaveAttribute('target', '_blank');
    expect(store.className).toMatch(/primary/);
    const zip = screen.getByRole('link', { name: zipLinkLabel(STORE) });
    expect(plain(zip.textContent ?? '')).toBe('Or load it unpacked (version 0.0.0-test, .zip)');
    expect(zip).toHaveAttribute('href', EXTENSION_ZIP_URL);
    expect(zip.className).toMatch(/secondary/);
    expect(screen.queryByRole('link', { name: zipLabel })).not.toBeInTheDocument();
    expect(howTo()).toHaveAttribute('aria-expanded', 'false');
    await expectNoAxeViolations();
  });

  it('takes the secondary style where the screen has its own primary button', () => {
    render(<main><ExtensionInstall status="not-installed" emphasis="secondary" /></main>);
    expect(screen.getByRole('link', { name: zipLabel }).className).toMatch(/secondary/);
    expect(screen.getByRole('link', { name: zipLabel }).className).not.toMatch(/primary/);
    expect(howTo()).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders nothing while the extension is off in this build', () => {
    const { container } = show('off');
    expect(container.querySelector('main')).toBeEmptyDOMElement();
  });

  it('reads the store\'s "off" as idle on the signed-in screens when this build has the extension', () => {
    expect(installStatus('off', 'abcdefghijklmnopabcdefghijklmnop')).toBe('idle');
    expect(installStatus('off', undefined)).toBe('off');
    expect(installStatus('connected', 'abcdefghijklmnopabcdefghijklmnop')).toBe('connected');
    expect(installStatus('not-installed', undefined)).toBe('not-installed');
  });

  it('uses no em dash, en dash or double hyphen in its copy', () => {
    for (const text of Object.values(EXTENSION_INSTALL)) {
      expect(text).not.toMatch(/[–—]|--/);
    }
  });
});
