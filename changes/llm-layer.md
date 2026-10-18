# The language layer

- The game can now talk to language models through OpenRouter with the player's own key: NPC replies stream in, and a second, cheap model reads each reply to work out what it changed in the NPC's mind (feelings, beliefs, promises they made, what they will remember).
- Several models can be configured, each tagged with what it is good at; every kind of request picks the best fitting model and falls back to the next one when a model is busy or fails.
- Every call's tokens and cost are recorded, per kind of request, per model, per NPC and per session, ready for the usage display.
