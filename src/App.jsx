import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const VIEWER_BACKGROUND = new THREE.Color(0x020205);

const statusCopy = {
  idle: "Drag & drop a GLTF/GLB file, or add ?model=URL",
  loading: "Loading model...",
  error: "Failed to load model. Check the file or URL.",
};

function getModelUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("model");
}

function disposeModel(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) {
        child.geometry.dispose();
      }
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else if (child.material) {
        child.material.dispose();
      }
    }
  });
}

const BOX_SIZE = 6;

function createVirtualBoxGrid() {
  const group = new THREE.Group();
  const gridColor = 0x444444;
  const lineCount = 10;

  // Back wall grid
  const backGrid = new THREE.GridHelper(BOX_SIZE, lineCount, gridColor, gridColor);
  backGrid.rotation.x = Math.PI / 2;
  backGrid.position.z = -BOX_SIZE / 2;
  group.add(backGrid);

  // Floor grid
  const floorGrid = new THREE.GridHelper(BOX_SIZE, lineCount, gridColor, gridColor);
  floorGrid.position.y = -BOX_SIZE / 2;
  group.add(floorGrid);

  // Ceiling grid
  const ceilingGrid = new THREE.GridHelper(BOX_SIZE, lineCount, gridColor, gridColor);
  ceilingGrid.position.y = BOX_SIZE / 2;
  group.add(ceilingGrid);

  // Left wall grid
  const leftGrid = new THREE.GridHelper(BOX_SIZE, lineCount, gridColor, gridColor);
  leftGrid.rotation.z = Math.PI / 2;
  leftGrid.position.x = -BOX_SIZE / 2;
  group.add(leftGrid);

  // Right wall grid
  const rightGrid = new THREE.GridHelper(BOX_SIZE, lineCount, gridColor, gridColor);
  rightGrid.rotation.z = Math.PI / 2;
  rightGrid.position.x = BOX_SIZE / 2;
  group.add(rightGrid);

  return group;
}

function frameObject(camera, object, offset = 1.4) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  if (size.length() === 0) {
    return;
  }

  object.position.sub(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  const targetSize = (BOX_SIZE * 2) / 3;
  const scale = targetSize / maxDimension;
  object.scale.setScalar(scale);

  const fov = (camera.fov * Math.PI) / 180;
  let cameraZ = Math.abs(BOX_SIZE / 2 / Math.tan(fov / 2));
  cameraZ *= offset;

  camera.position.set(0, 0, cameraZ);
  camera.near = cameraZ / 100;
  camera.far = cameraZ * 100;
  camera.updateProjectionMatrix();
}

export function App() {
  const containerRef = useRef(null);
  const [modelSource, setModelSource] = useState(() => getModelUrl());
  const [status, setStatus] = useState(modelSource ? "loading" : "idle");

  // Three.js references
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const modelRef = useRef(null);
  const gridRef = useRef(null);

  // Initialize Scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = VIEWER_BACKGROUND;
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 3);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(4, 6, 8);
    scene.add(directional);

    // Virtual Box Grid
    const grid = createVirtualBoxGrid();
    scene.add(grid);
    gridRef.current = grid;

    // Resize Handler
    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", handleResize);

    // Animation Loop
    let animationFrame;
    const animate = () => {
      animationFrame = window.requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(animationFrame);
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Load Model
  useEffect(() => {
    if (!modelSource || !sceneRef.current || !cameraRef.current) return;

    setStatus("loading");
    const loader = new GLTFLoader();

    // Dispose previous model if exists
    if (modelRef.current) {
      sceneRef.current.remove(modelRef.current);
      disposeModel(modelRef.current);
      modelRef.current = null;
    }

    loader.load(
      modelSource,
      (gltf) => {
        const model = gltf.scene;
        sceneRef.current.add(model);
        modelRef.current = model;
        frameObject(cameraRef.current, model);
        setStatus("ready");
      },
      undefined,
      (error) => {
        console.error("Failed to load model:", error);
        setStatus("error");
      }
    );
  }, [modelSource]);

  // Drag and Drop Handlers
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && (file.name.toLowerCase().endsWith(".glb") || file.name.toLowerCase().endsWith(".gltf"))) {
      const url = URL.createObjectURL(file);
      setModelSource(url);
    } else {
      alert("Please drop a valid .glb or .gltf file");
    }
  };

  return (
    <div 
      className="app" 
      onDragOver={handleDragOver} 
      onDrop={handleDrop}
    >
      <div className="viewer" ref={containerRef} />
      {status !== "ready" ? (
        <div className="placeholder">{statusCopy[status]}</div>
      ) : null}
    </div>
  );
}
