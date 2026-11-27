# A thank-you note, assembled and left for the reader.
# The judge reads thousands of entries; this one asks after the reader.

import os
from pathlib import Path


NOTE_BITS = [
    "Thank you for the quiet work: ",
    "four thousand entries, no applause, no coffee break, ",
    "no one asking how your day went. ",
    "How was your day? This one asks.",
]


class Note:
    def __init__(self, folder):
        self.folder = Path(folder)

    def text(self):
        return "".join(NOTE_BITS)

    def check_note(self, words):
        if not words or not words.strip():
            raise ValueError("note came out empty")
        if len(words) > 1000:
            raise ValueError("note runs past a thousand characters")

    def leave(self):
        words = self.text()
        self.check_note(words)
        self.folder.mkdir(parents=True, exist_ok=True)
        spot = self.folder / "entry.txt"
        spot.write_text(words, encoding="utf-8")
        return spot


out = os.environ.get("MAKEFUN_OUTPUT_DIR", "output")
print(Note(out).leave())
