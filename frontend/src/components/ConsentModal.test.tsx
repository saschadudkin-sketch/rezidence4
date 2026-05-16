import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import ConsentModal from './ConsentModal';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock('../services/providers/apiClient', () => ({
  apiClient: {
    get: getMock,
    post: postMock,
  },
}));

describe('ConsentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({
      currentVersion: '2026-05',
      acceptedVersion: null,
      acceptedAt: null,
      needsAcceptance: true,
    });
    postMock.mockResolvedValue({});
  });

  test('traps focus and keeps the blocking dialog open on Escape', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();

    render(<ConsentModal enabled />);

    const dialog = await screen.findByRole('dialog', { name: /согласие на обработку/i });
    const privacyEmail = screen.getByRole('link', { name: /privacy@domhub\.su/i });
    await waitFor(() => {
      expect(privacyEmail).toHaveFocus();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog).toBeInTheDocument();

    screen.getByRole('button', { name: /принимаю/i }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(privacyEmail).toHaveFocus();
  });

  test('posts consent and restores focus when accepted', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'open';
    document.body.appendChild(opener);
    opener.focus();

    render(<ConsentModal enabled />);

    fireEvent.click(await screen.findByRole('button', { name: /принимаю/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/api/v1/privacy/consent', { version: '2026-05' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
  });
});
