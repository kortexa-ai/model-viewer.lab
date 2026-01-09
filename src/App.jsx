import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const VIEWER_BACKGROUND = new THREE.Color(0x020205);

const statusCopy = {
  idle: "Add ?model=URL to load a GLTF/GLB file.",
  loading: "Loading model...",
  error: "Failed to load model. Check the URL and CORS settings.",
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

function frameObject(camera, object, offset = 1.4) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  if (size.length() === 0) {
    return;
  }

  object.position.sub(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  let cameraZ = Math.abs(maxDimension / 2 / Math.tan(fov / 2));
  cameraZ *= offset;

  camera.position.set(0, 0, cameraZ);
  camera.near = cameraZ / 100;
  camera.far = cameraZ * 100;
  camera.updateProjectionMatrix();
}

export function App() {
  const containerRef = useRef(null);
  const modelUrl = useMemo(() => getModelUrl(), []);
  const [status, setStatus] = useState(modelUrl ? "loading" : "idle");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = VIEWER_BACKGROUND;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 0, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(4, 6, 8);
    scene.add(directional);

    const loader = new GLTFLoader();
    let activeModel = null;
    let animationFrame = null;
    let disposed = false;

    const handleResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const animate = () => {
      animationFrame = window.requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };

    const loadModel = (url) => {
      if (!url) {
        return;
      }
      loader.load(
        url,
        (gltf) => {
          if (disposed) {
            return;
          }
          if (activeModel) {
            scene.remove(activeModel);
            disposeModel(activeModel);
          }
          activeModel = gltf.scene;
          scene.add(activeModel);
          frameObject(camera, activeModel);
          setStatus("ready");
        },
        undefined,
        (error) => {
          if (disposed) {
            return;
          }
          console.error("Failed to load model:", error);
          setStatus("error");
        }
      );
    };

    window.addEventListener("resize", handleResize);
    animate();
    loadModel(modelUrl);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (activeModel) {
        scene.remove(activeModel);
        disposeModel(activeModel);
      }
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [modelUrl]);

  return (
    <div className="app">
      <div className="viewer" ref={containerRef} />
      {status !== "ready" ? (
        <div className="placeholder">{statusCopy[status]}</div>
      ) : null}
    </div>
  );
}
