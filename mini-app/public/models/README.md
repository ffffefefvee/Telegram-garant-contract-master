# 3D models

## glass-lock.gltf
Optimized, web-ready **glass padlock** model for use as a UI background element.

- Self-contained `.gltf` (geometry buffer embedded as base64 — no external `.bin`).
- meshopt-compressed, ~120k triangles, textures stripped (render it as glass).
- Served statically by Vite from `public/`.

**Runtime path:** `/models/glass-lock.gltf`

### Load with three.js
```ts
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.load(import.meta.env.BASE_URL + "models/glass-lock.gltf", (gltf) => {
  gltf.scene.traverse((o) => {
    if (o.isMesh) o.material = glassMaterial; // your MeshPhysicalMaterial (transmission)
  });
  scene.add(gltf.scene);
});
```
Requires the `three` dependency (not yet added to package.json).
