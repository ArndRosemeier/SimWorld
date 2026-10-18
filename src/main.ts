/**
 * Entry point. For now: the render foundation only (renderer on WebGL 2, the Stage's warm-up, a
 * placeholder ground and blocks), so the shader policy is live from the first commit. The town,
 * the selector-as-loading-screen and the game come in their own changes (docs/design/simworld-plan.md).
 */
import { Color, PerspectiveCamera, Scene } from 'three/webgpu';
import { createRenderer, GraphicsUnavailable } from './render/renderer';
import { Stage } from './render/stage';
import { makeLights } from './render/lights';
import { VERTEX_COLOR_SOLID } from './render/materials';
import { meshFromData } from './render/meshes';
import { placeholderBlocks } from './app/placeholder';

async function start(): Promise<void> {
  const canvas = document.createElement('canvas');
  document.body.prepend(canvas);
  const { renderer } = await createRenderer(canvas);
  const scene = new Scene();
  scene.background = new Color(0x9cc4e8);
  const camera = new PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(60, 45, 60);
  camera.lookAt(0, 0, 0);
  const resize = (): void => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  resize();
  addEventListener('resize', resize);
  renderer.shadowMap.enabled = true;
  makeLights(scene);
  const stage = new Stage(renderer, scene, camera);
  await stage.warmUp();
  await stage.add(meshFromData(placeholderBlocks(1), VERTEX_COLOR_SOLID));
  document.getElementById('loading')?.remove();
  const hud = document.getElementById('hud');
  renderer.setAnimationLoop((t: number) => {
    stage.frame();
    const a = t * 0.00005;
    camera.position.set(Math.cos(a) * 85, 45, Math.sin(a) * 85);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    if (hud) hud.textContent = stage.hudLine();
  });
}

start().catch((err) => {
  const el = document.querySelector('#loading .step');
  if (el) el.textContent = err instanceof GraphicsUnavailable ? 'This browser cannot draw 3D graphics (WebGL 2 needed).' : `Start failed: ${err instanceof Error ? err.message : String(err)}`;
  throw err;
});
