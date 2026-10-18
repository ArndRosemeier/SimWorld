# Saves and the time skip in the game

- The game saves the town when you switch away from the tab and every five minutes. Open it with `?resume` to play on from the last save.
- `?skip=N` skips N days on start, to the same time of day; the town lives through them (life events, gossip) and everyone is drawn afresh.
- Saves go to the browser's IndexedDB, gzipped, one per town.
