# Chat models picked by live tests

- NPCs now answer in chat with GLM by default (fast, natural, cheap), falling back to Gemini Flash and Mistral Large 4. The big, expensive models are no longer defaults; you can still add any OpenRouter model and choose models per task.
- What a conversation changes in an NPC's mind is read by Claude Haiku, then GPT Luna, then Mistral Large 4. Memories of conversations use GPT Luna first, the time-skip recap Claude Haiku. Defaults follow each vendor's newest model automatically.
- Fixed: models that think before answering sometimes returned nothing, because their thinking used up the reply's room.
- Fixed: people named as "Tom Brandt [P2]" or by name only were dropped from what an NPC remembers, and names could appear doubled ("Tom Tom Brandt").
- The time-skip recap now talks to you as your character ("Tom asked you to the dance") and sticks to what happened.
