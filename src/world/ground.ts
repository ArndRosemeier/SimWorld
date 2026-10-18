/**
 * Ground levels shared by the planner, the world queries and the meshes (Scale:
 * build/ground.ts CURB_H, build/terrainMesh.ts TERRAIN_DROP).
 */

/** Height of the curb: sidewalks, squares and building floors stand this much above the road. */
export const CURB_H = 0.15;

/** The terrain mesh is drawn this much below the natural ground, so paved surfaces never fight it. */
export const TERRAIN_DROP = 0.35;
