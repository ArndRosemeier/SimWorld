# Lighter distant trees, and headless shots that stay lit

- Trees between 45 and 150 m are now drawn as a lighter tree with the same shape (about a quarter of the triangles), and countryside forest far away as a simpler canopy. Forest outside the town no longer goes through the shadow pass, since its shadows fall outside the shadow map anyway. All together that halves the triangles of a view over the town.
- The headless screenshot tools (the nightly looks check, repro links) space their frames out. Software rendering needs seconds per frame for the whole town, and back-to-back frames used to crash its GPU process a minute in, so close-ups and street views came out black.
- The looks check has a close-up of a parked car again.
