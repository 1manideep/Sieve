import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axe';
import { ConfirmDialog, Dialog } from './Dialog';

function Opener({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        title="Name this computer"
        description="Requests come to this tab."
        dismissible={dismissible}
        onClose={() => setOpen(false)}
        footer={<button type="button">Save</button>}
      >
        <label htmlFor="f">Name</label>
        <input id="f" />
      </Dialog>
    </main>
  );
}

describe('Dialog', () => {
  it('labels itself, focuses the first field, closes on Esc and returns focus to the opener', async () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Name this computer' });
    expect(dialog).toHaveAccessibleDescription('Requests come to this tab.');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await expectNoAxeViolations();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('has no close button and ignores Esc when not dismissible', async () => {
    render(<Opener dismissible={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('focuses the confirm button, disables both buttons while the action runs, then resolves', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onCancel = vi.fn();
    render(
      <main>
        <ConfirmDialog open title="Reset the Playground?" body="This deletes the files." confirmLabel="Reset" tone="danger" onConfirm={onConfirm} onCancel={onCancel} />
      </main>,
    );
    const confirm = screen.getByRole('button', { name: 'Reset' });
    expect(confirm).toHaveFocus();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled());
    await expectNoAxeViolations();
  });
});
