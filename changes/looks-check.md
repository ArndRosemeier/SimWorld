# A nightly check that every surface still draws

- Every night the build draws each kind of surface in the town (walls, roofs, roads, street furniture, cars, trees, rooms, sky, rain, smoke) in each of its variants, and flags any that come out black, glaring white, broken or missing, so a shader bug like the black street furniture is caught the next morning instead of hours later.
- It also photographs the town from four fixed cameras (noon, a street view, night, snow) and flags when their colours shift.
