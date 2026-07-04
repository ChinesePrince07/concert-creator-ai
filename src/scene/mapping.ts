import * as THREE from 'three';
import { KEYBOARD_WIDTH_MM } from '../core/keyboard';

/**
 * Keyboard space (mm: x along keys from A0's left edge, y above white-key
 * tops, z from fallboard toward the player) → world space (meters).
 * World: keyboard centered on x=0, white-key tops at KEY_TOP_Y, +z toward
 * the pianist, piano body extends into -z.
 */

export const KEY_TOP_Y = 0.735;

export function kbToWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((x - KEYBOARD_WIDTH_MM / 2) / 1000, KEY_TOP_Y + y / 1000, z / 1000);
}

export const KEYBOARD_WIDTH_M = KEYBOARD_WIDTH_MM / 1000;
