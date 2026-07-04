import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * User-supplied photoreal piano body (public/assets/piano/custom.glb).
 * The model is normalized to the app's world: floor at y=0, keyboard side
 * toward +z, case width matched to the 88-key keyboard. The app's animated
 * keys render on top of the model's baked (static) keys.
 */

let cached: Promise<THREE.Group | null> | null = null;

export function loadCustomPiano(): Promise<THREE.Group | null> {
  if (!cached) {
    cached = new GLTFLoader()
      .loadAsync('/assets/piano/custom.glb')
      .then((gltf) => {
        const src = gltf.scene;
        src.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(src);
        const size = box.getSize(new THREE.Vector3());

        const group = new THREE.Group();
        group.add(src);

        // long axis along z (body depth), keyboard along x
        if (size.x > size.z) {
          src.rotation.y = Math.PI / 2;
          src.updateMatrixWorld(true);
        }
        let b = new THREE.Box3().setFromObject(src);
        let s = b.getSize(new THREE.Vector3());

        // scale: calibrated so the model's key slab meets the app's keys
        const scale = 1.31 / s.x;
        src.scale.setScalar(scale);
        src.updateMatrixWorld(true);
        b = new THREE.Box3().setFromObject(src);
        s = b.getSize(new THREE.Vector3());

        // floor at y=0, centered on x, keyboard face at z ≈ +0.19
        const c = b.getCenter(new THREE.Vector3());
        src.position.x -= c.x;
        src.position.y -= b.min.y + 0.012; // sink: app's live keys sit proud of the model's baked keys
        src.position.z += 0.145 - b.max.z;
        src.updateMatrixWorld(true);
        const fb = new THREE.Box3().setFromObject(src);
        console.log('[custom-piano] final size', fb.getSize(new THREE.Vector3()).toArray().map(v=>v.toFixed(3)).join(' '), 'min', fb.min.toArray().map(v=>v.toFixed(3)).join(' '), 'max', fb.max.toArray().map(v=>v.toFixed(3)).join(' '));

        src.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const m = o.material as THREE.MeshStandardMaterial;
            if (m && m.isMeshStandardMaterial) {
              m.envMapIntensity = 1.0;
            }
          }
        });
        return group;
      })
      .catch((err) => {
        console.warn('[custom-piano] no custom glb, keeping procedural piano', err);
        return null;
      });
  }
  return cached;
}
