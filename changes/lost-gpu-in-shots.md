# Screenshot tools notice a lost GPU

- The game marks the page `data-gpu="lost"` when its WebGL context is lost, so headless shots no longer come out black without a word.
- The looks check takes a shot again once when the GPU gave up, and fails with a clear message if it happens twice.
- Opening a repro link headless tries once more with a shorter wait when the GPU gave up, and says so.
