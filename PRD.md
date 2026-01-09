# Model Viewer Demo

## Goals

A 3D model viewer that allows users to inspect GLTF models using Three.js. The viewer utilizes MediaPipe for face tracking to control the camera perspective, creating a "parallax window" effect. As the user leans, the view adjusts to simulate looking into a 3D box containing the model.

## Reference Implementations

- **Project Structure**: `../weird.lab` (Use as base for build/vite/react setup, but clean out specific app logic).
- **Face Tracking Behavior**: `../cerebellum` (Reference for sensitivity and mapping logic).

## Requirements

### Project Setup
- [x] Initialize project using `../weird.lab` as a structural template.
- [x] Copy configuration (vite, biome, tailwind, etc.), `nginx/`, and directory structure.
- [x] **Important**: Remove `weird.lab` specific application logic/components.
- [x] Update `package.json` name and dependencies.

### Core Features
- [x] **GLTF Loader**:
  - [x] Support loading models via URL parameters.
  - [x] Support loading models via local file drag-and-drop or selection.
- [x] **Parallax View**:
  - [x] Render a "virtual box" grid. The device screen acts as the front window of this box.
  - [x] Position loaded models in the center of this box, scaled to ~2/3 of the box size.
  - [x] **Face Tracking (MediaPipe)**:
    - [x] Track user face position relative to the center of the screen.
    - [x] **Input Scaling**: Scale horizontal movement by **3x** and vertical movement by **1.5x**.
    - [x] **Perspective Update**: Adjust the camera/scene to simulate the user's changing viewing angle. Both the model and the background grid must transform to maintain the illusion of depth (parallax).

## Technical Specs

- **Stack**: React, Vite, Three.js, MediaPipe Face Mesh.
- **Language**: JavaScript/TypeScript.
- **Resources**:
  - [Three.js LLM Guide](https://github.com/mrdoob/three.js/blob/1e981649c79b93db2c3f82dba05347b0b1ceedc6/docs/llms-full.txt)

## Success Criteria

1.  Project builds (`npm run build`) and runs locally (`npm run dev`) without errors.
2.  User can load a GLTF model.
3.  "Box" grid is visible and provides depth cues.
4.  Moving head left/right/up/down changes the perspective correctly (Parallax effect) with specified sensitivity (3x horiz, 1.5x vert).