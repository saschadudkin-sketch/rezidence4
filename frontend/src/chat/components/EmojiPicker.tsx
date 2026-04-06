import React from 'react';
import { EMOJI_GRID } from '../constants';

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
}

export function EmojiPicker({ onPick }: EmojiPickerProps) {
  return (
    <div className="emoji-picker">
      {EMOJI_GRID.map(em => (
        <button key={em} className="emoji-pick-btn" onClick={() => onPick(em)}>
          {em}
        </button>
      ))}
    </div>
  );
}
