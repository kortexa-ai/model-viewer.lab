import {
	FaceLandmarker,
	FilesetResolver,
	HandLandmarker,
} from "@mediapipe/tasks-vision";
import { Box, FolderOpen, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clsx } from "clsx";

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
				for (const material of child.material) {
					material.dispose();
				}
			} else if (child.material) {
				child.material.dispose();
			}
		}
	});
}

// The box depth is fixed, but width/height will match viewport aspect
const BOX_DEPTH = 10;
const FIXED_HEIGHT = 10; // World units for height

function createVirtualBoxGrid(width, height, depth) {
	const group = new THREE.Group();
	const gridColor = 0x444444;
	const lineCount = 10;

	// Back wall grid (at z = -depth)
	const backGrid = new THREE.GridHelper(
		Math.max(width, depth),
		lineCount,
		gridColor,
		gridColor,
	);
	backGrid.rotation.x = Math.PI / 2;
	backGrid.position.z = -depth;
	backGrid.position.y = 0;
	backGrid.scale.set(
		width / Math.max(width, depth),
		1,
		height / Math.max(width, depth),
	);
	group.add(backGrid);

	// Floor grid
	const floorGrid = new THREE.GridHelper(
		Math.max(width, depth),
		lineCount,
		gridColor,
		gridColor,
	);
	floorGrid.position.y = -height / 2;
	floorGrid.position.z = -depth / 2;
	floorGrid.scale.set(
		width / Math.max(width, depth),
		1,
		depth / Math.max(width, depth),
	);
	group.add(floorGrid);

	// Ceiling grid
	const ceilingGrid = new THREE.GridHelper(
		Math.max(width, depth),
		lineCount,
		gridColor,
		gridColor,
	);
	ceilingGrid.position.y = height / 2;
	ceilingGrid.position.z = -depth / 2;
	ceilingGrid.scale.set(
		width / Math.max(width, depth),
		1,
		depth / Math.max(width, depth),
	);
	group.add(ceilingGrid);

	// Left wall grid
	const leftGrid = new THREE.GridHelper(
		Math.max(depth, height),
		lineCount,
		gridColor,
		gridColor,
	);
	leftGrid.rotation.z = Math.PI / 2;
	leftGrid.position.x = -width / 2;
	leftGrid.position.z = -depth / 2;
	leftGrid.scale.set(
		height / Math.max(depth, height),
		1,
		depth / Math.max(depth, height),
	);
	group.add(leftGrid);

	// Right wall grid
	const rightGrid = new THREE.GridHelper(
		Math.max(depth, height),
		lineCount,
		gridColor,
		gridColor,
	);
	rightGrid.rotation.z = Math.PI / 2;
	rightGrid.position.x = width / 2;
	rightGrid.position.z = -depth / 2;
	rightGrid.scale.set(
		height / Math.max(depth, height),
		1,
		depth / Math.max(depth, height),
	);
	group.add(rightGrid);

	return group;
}

function frameObject(object, boxWidth, boxHeight, boxDepth) {
    // Ensure matrix is updated for accurate bounding box
    object.updateMatrixWorld(true);

	const box = new THREE.Box3().setFromObject(object);
	const size = box.getSize(new THREE.Vector3());

	if (size.length() === 0) {
		return;
	}

	// Scale first
	const maxDimension = Math.max(size.x, size.y, size.z);
	const targetSize = Math.min(boxWidth, boxHeight, boxDepth) * 0.6;
	const scale = targetSize / maxDimension;
	object.scale.setScalar(scale);

	// Recalculate bounding box after scaling
	object.updateMatrixWorld(true);
	const scaledBox = new THREE.Box3().setFromObject(object);
	const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

	// Center the scaled model
	object.position.sub(scaledCenter);
	object.position.z = -boxDepth / 2;
}

function getModelMetadata(object, sourceName) {
	let vertices = 0;
	let triangles = 0;

	object.traverse((child) => {
		if (child.isMesh && child.geometry) {
			vertices += child.geometry.attributes.position.count;
			if (child.geometry.index) {
				triangles += child.geometry.index.count / 3;
			} else {
				triangles += child.geometry.attributes.position.count / 3;
			}
		}
	});

	return {
		name: sourceName || "Unknown Model",
		vertices: vertices.toLocaleString(),
		triangles: Math.floor(triangles).toLocaleString(),
	};
}

export function App() {
	const containerRef = useRef(null);
	const videoRef = useRef(null);
	const fileInputRef = useRef(null);
	const textureFileInputRef = useRef(null);

	// State
	const [modelSource, setModelSource] = useState(() => getModelUrl());
	const [modelName, setModelName] = useState(() => {
		const url = getModelUrl();
		if (!url) return null;
		try {
			const parts = url.split("/");
			return parts[parts.length - 1] || "URL Model";
		} catch {
			return "URL Model";
		}
	});
	const [status, setStatus] = useState(modelSource ? "loading" : "idle");
	const [metadata, setMetadata] = useState(null);
	const [animations, setAnimations] = useState([]);
	const [activeAnimIndex, setActiveAnimIndex] = useState(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [missingTextures, setMissingTextures] = useState([]);

	// Three.js references
	const sceneRef = useRef(null);
	const cameraRef = useRef(null);
	const rendererRef = useRef(null);
	const modelRef = useRef(null);
	const gridRef = useRef(null);
	const dimsRef = useRef({
		width: FIXED_HEIGHT,
		height: FIXED_HEIGHT,
		depth: BOX_DEPTH,
	});
	const mixerRef = useRef(null);
	const actionsRef = useRef([]);
	const clockRef = useRef(new THREE.Clock());
	const materialsNeedingTexturesRef = useRef([]); // [{material, mapType, expectedPath}]

	// Tracking references
	const faceLandmarkerRef = useRef(null);
	const handLandmarkerRef = useRef(null);
	const facePositionRef = useRef({ x: 0, y: 0 });
	const isPinchingRef = useRef(false);
	const prevPinchRef = useRef(null); // {x, y}
	const requestRef = useRef(null);
	const lastVideoTimeRef = useRef(-1);
    const lastTrackingTimeRef = useRef(0);
    const frameCounterRef = useRef(0);

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
			1000,
		);
		camera.position.set(0, 0, 20);
		cameraRef.current = camera;

		// Renderer
		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.outputColorSpace = THREE.SRGBColorSpace; // Critical for correct color rendering
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.0;
		container.appendChild(renderer.domElement);
		rendererRef.current = renderer;

		// Lights
		const ambient = new THREE.AmbientLight(0xffffff, 0.75);
		scene.add(ambient);

		const directional = new THREE.DirectionalLight(0xffffff, 0.9);
		directional.position.set(4, 6, 8);
		scene.add(directional);

		// Initial Grid Setup
		const aspect = container.clientWidth / container.clientHeight;
		const width = FIXED_HEIGHT * aspect;
		const height = FIXED_HEIGHT;
		dimsRef.current = { width, height, depth: BOX_DEPTH };

		const grid = createVirtualBoxGrid(width, height, BOX_DEPTH);
		scene.add(grid);
		gridRef.current = grid;

		// Resize Handler
		const handleResize = () => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			const newAspect = w / h;

			renderer.setSize(w, h);

			// Update Box Dimensions to match viewport
			const newWidth = FIXED_HEIGHT * newAspect;
			dimsRef.current = {
				width: newWidth,
				height: FIXED_HEIGHT,
				depth: BOX_DEPTH,
			};

			// Recreate Grid
			if (gridRef.current) {
				scene.remove(gridRef.current);
				gridRef.current.children.forEach((c) => c.geometry.dispose());
			}
			const newGrid = createVirtualBoxGrid(newWidth, FIXED_HEIGHT, BOX_DEPTH);
			scene.add(newGrid);
			gridRef.current = newGrid;

			// Re-frame model if it exists
			if (modelRef.current) {
				frameObject(
					modelRef.current,
					newWidth,
					FIXED_HEIGHT,
					BOX_DEPTH,
				);
			}
		};
		window.addEventListener("resize", handleResize);

		// Animation Loop
		let animationFrame;
		const animate = () => {
			animationFrame = window.requestAnimationFrame(animate);

			const delta = clockRef.current.getDelta();

			// Update Mixer
			if (mixerRef.current) {
				mixerRef.current.update(delta);
			}

			// Update camera position based on face tracking
			const facePos = facePositionRef.current;
			const rangeX = 15;
			const rangeY = 15;

			camera.position.x = -facePos.x * rangeX;
			camera.position.y = facePos.y * rangeY;
			camera.position.z = 20;

			// Off-Axis Projection
			const dist = camera.position.z;
			const camPos = camera.position;
			const halfW = dimsRef.current.width / 2;
			const halfH = dimsRef.current.height / 2;
			const left = -halfW - camPos.x;
			const right = halfW - camPos.x;
			const top = halfH - camPos.y;
			const bottom = -halfH - camPos.y;
			const near = 0.1;
			const scale = near / dist;

			camera.projectionMatrix.makePerspective(
				left * scale,
				right * scale,
				top * scale,
				bottom * scale,
				near,
				1000,
			);
			camera.rotation.set(0, 0, 0);

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

	// Initialize Tracking (Face + Hands)
	useEffect(() => {
		/*
		const video = videoRef.current;
		if (!video) return;

		const initTracking = async () => {
			try {
				const vision = await FilesetResolver.forVisionTasks(
					"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
				);

				faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(
					vision,
					{
						baseOptions: {
							modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
							delegate: "GPU",
						},
						outputFaceBlendshapes: true,
						runningMode: "VIDEO", // Changed back to VIDEO
						numFaces: 1,
					},
				);

				handLandmarkerRef.current = await HandLandmarker.createFromOptions(
					vision,
					{
						baseOptions: {
							modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
							delegate: "GPU",
						},
						runningMode: "VIDEO", // Changed back to VIDEO
						numHands: 1,
					},
				);

				const stream = await navigator.mediaDevices.getUserMedia({
					video: { width: 640, height: 480 },
				});
				video.srcObject = stream;
				await video.play();

				const predictWebcam = () => {
                    const now = performance.now();
                    // Throttle tracking loop to ~30 FPS (33ms)
                    if (now - lastTrackingTimeRef.current >= 33 && video.currentTime !== lastVideoTimeRef.current) {
                        lastTrackingTimeRef.current = now;
                        lastVideoTimeRef.current = video.currentTime;
                        
                        // Interleave detections:
                        // Even frames: Face
                        // Odd frames: Hands
                        const frameCount = frameCounterRef.current++;
                        
                        if (frameCount % 2 === 0) {
                            if (faceLandmarkerRef.current) {
                                const result = faceLandmarkerRef.current.detectForVideo(video, now);
                                if (result.faceLandmarks && result.faceLandmarks.length > 0) {
                                    const landmarks = result.faceLandmarks[0];
                                    const noseTip = landmarks[1];
                                    const offsetX = noseTip.x - 0.5;
                                    const offsetY = 0.5 - noseTip.y;
                                    facePositionRef.current = { x: offsetX * 2, y: offsetY * 2 };
                                }
                            }
                        } else {
                            if (handLandmarkerRef.current) {
                                const result = handLandmarkerRef.current.detectForVideo(video, now);
                                if (result.landmarks && result.landmarks.length > 0) {
                                    const landmarks = result.landmarks[0];
                                    const thumbTip = landmarks[4];
                                    const indexTip = landmarks[8];

                                    const distance = Math.sqrt(
                                        Math.pow(thumbTip.x - indexTip.x, 2) +
                                            Math.pow(thumbTip.y - indexTip.y, 2),
                                    );

                                    const isPinching = distance < 0.1;
                                    const pinchX = (thumbTip.x + indexTip.x) / 2;
                                    const pinchY = (thumbTip.y + indexTip.y) / 2;

                                    if (isPinching && modelRef.current) {
                                        if (isPinchingRef.current && prevPinchRef.current) {
                                            const deltaX = pinchX - prevPinchRef.current.x;
                                            const deltaY = pinchY - prevPinchRef.current.y;
                                            const sensitivity = 5;
                                            modelRef.current.rotation.y += deltaX * sensitivity;
                                            modelRef.current.rotation.x += deltaY * sensitivity;
                                        }
                                        prevPinchRef.current = { x: pinchX, y: pinchY };
                                    } else {
                                        prevPinchRef.current = null;
                                    }
                                    isPinchingRef.current = isPinching;
                                } else {
                                    isPinchingRef.current = false;
                                    prevPinchRef.current = null;
                                }
                            }
                        }
                    }
					requestRef.current = requestAnimationFrame(predictWebcam);
				};
                
				predictWebcam();
			} catch (err) {
				console.error("Tracking init error:", err);
			}
		};

		initTracking();

		return () => {
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
            if (video.srcObject) {
                const tracks = video.srcObject.getTracks();
                tracks.forEach(t => t.stop());
            }
            if (faceLandmarkerRef.current) {
                faceLandmarkerRef.current.close();
            }
             if (handLandmarkerRef.current) {
                handLandmarkerRef.current.close();
            }
		};
		*/
	}, []);

	// Load Model
	useEffect(() => {
		if (!modelSource || !sceneRef.current || !cameraRef.current) {
			setMetadata(null);
			setAnimations([]);
			setActiveAnimIndex(null);
			return;
		}

		setStatus("loading");

		// Track texture loading errors
		const textureErrors = [];
		const loadingManager = new THREE.LoadingManager();

		loadingManager.onError = (url) => {
			// Extract filename from URL
			const filename = url.split('/').pop().split('\\').pop();
			if (!textureErrors.includes(filename)) {
				textureErrors.push(filename);
			}
		};

		const loader = new GLTFLoader(loadingManager);

        // 1. CLEAR PREVIOUS MODEL - Immediate Cleanup
		if (modelRef.current) {
			sceneRef.current.remove(modelRef.current);
			disposeModel(modelRef.current);
			modelRef.current = null;
		}

		// Reset Mixer and Textures
		mixerRef.current = null;
		actionsRef.current = [];
		setAnimations([]);
		setActiveAnimIndex(null);
		setIsPlaying(false);
		setMissingTextures([]);
		materialsNeedingTexturesRef.current = [];

		loader.load(
			modelSource,
			(gltf) => {
				const model = gltf.scene;
                
                // 2. DOUBLE CHECK - Before adding, ensure we didn't start loading another model in parallel
                if (modelSource !== getModelUrl() && !modelName.includes("URL")) {
                     // This is a naive check (checking current URL param vs closure).
                     // Better: check if we are still the active request?
                     // For simplicity: We will trust the React effect cleanup has run if source changed.
                     // But we must ensure we remove any *other* model that might have snuck in (unlikely with this effect structure).
                     if (modelRef.current) {
                         sceneRef.current.remove(modelRef.current);
                         disposeModel(modelRef.current);
                     }
                } else if (modelRef.current) {
                     // If we already have a model ref (maybe from a race condition?), remove it.
                     sceneRef.current.remove(modelRef.current);
                     disposeModel(modelRef.current);
                }

				sceneRef.current.add(model);
				modelRef.current = model;
				frameObject(
					model,
					dimsRef.current.width,
					dimsRef.current.height,
					dimsRef.current.depth,
				);
				setStatus("ready");

				// Metadata
				setMetadata(getModelMetadata(model, modelName));

				// Animations
				if (gltf.animations && gltf.animations.length > 0) {
					setAnimations(gltf.animations);
					const mixer = new THREE.AnimationMixer(model);
					mixerRef.current = mixer;

					// Create actions for all clips
					actionsRef.current = gltf.animations.map((clip) =>
						mixer.clipAction(clip),
					);
				}

				// Check for missing textures using LoadingManager errors
				// Wait a bit for async texture loads to complete/fail
				setTimeout(() => {
					if (textureErrors.length > 0) {
						// Find which materials need these textures
						const materialInfo = [];
						model.traverse((child) => {
							if (child.isMesh && child.material) {
								const materials = Array.isArray(child.material) ? child.material : [child.material];
								materials.forEach((material) => {
									// Add all materials to the list for each failed texture
									// (most models have few materials, so this is fine)
									textureErrors.forEach((filename) => {
										// Add entry for 'map' type (most common for colormap)
										materialInfo.push({
											material,
											mapType: 'map',
											expectedFilename: filename,
											originalPath: filename
										});
									});
								});
							}
						});
						materialsNeedingTexturesRef.current = materialInfo;
						setMissingTextures(textureErrors);
					}
				}, 200);
			},
			undefined,
			(error) => {
				console.error("Failed to load model:", error);
				setStatus("error");
			},
		);
        
        // CLEANUP FUNCTION for the effect itself
        return () => {
            // If the component unmounts or modelSource changes while loading,
            // we can't easily cancel GLTFLoader (it doesn't return abort controller easily).
            // But we CAN ensure that if a model arrives later, we don't use it, OR if we have one, we remove it.
            // However, doing it here might remove the *newly* loaded model if the effect re-runs.
            // The synchronous cleanup at the start of the effect is usually safer for "switching" models.
        };
	}, [modelSource, modelName]);

	// Handlers
	const handleFileSelect = (e) => {
		const file = e.target.files[0];
		if (
			file &&
			(file.name.toLowerCase().endsWith(".glb") ||
				file.name.toLowerCase().endsWith(".gltf"))
		) {
			const url = URL.createObjectURL(file);
			setModelSource(url);
			setModelName(file.name);
		}
	};

	const handleDragOver = (e) => e.preventDefault();
	const handleDrop = (e) => {
		e.preventDefault();
		const file = e.dataTransfer.files[0];
		if (
			file &&
			(file.name.toLowerCase().endsWith(".glb") ||
				file.name.toLowerCase().endsWith(".gltf"))
		) {
			const url = URL.createObjectURL(file);
			setModelSource(url);
			setModelName(file.name);
		} else {
			alert("Please drop a valid .glb or .gltf file");
		}
	};

	const handleTextureSelect = (e) => {
		const files = Array.from(e.target.files);
		if (files.length === 0) return;

		const textureLoader = new THREE.TextureLoader();
		const loadedTextures = new Map(); // filename -> texture
		let loadedCount = 0;

		// Load all selected texture files
		files.forEach((file) => {
			const url = URL.createObjectURL(file);
			const filename = file.name;

			textureLoader.load(
				url,
				(texture) => {
					// Set proper color space for color maps (base color textures)
					// This is critical for correct color rendering in Three.js
					texture.colorSpace = THREE.SRGBColorSpace;

					// Common texture settings
					texture.flipY = false; // GLTF textures are not flipped
					texture.wrapS = THREE.RepeatWrapping;
					texture.wrapT = THREE.RepeatWrapping;

					texture.needsUpdate = true;

					loadedTextures.set(filename, texture);
					loadedCount++;

					// When all textures are loaded, apply them to materials
					if (loadedCount === files.length) {
						applyTexturesToMaterials(loadedTextures);
					}
				},
				undefined,
				(error) => {
					console.error(`Failed to load texture ${filename}:`, error);
					loadedCount++;
					if (loadedCount === files.length) {
						applyTexturesToMaterials(loadedTextures);
					}
				}
			);
		});
	};

	const applyTexturesToMaterials = (loadedTextures) => {
		let appliedCount = 0;
		const stillMissing = new Set(missingTextures);

		materialsNeedingTexturesRef.current.forEach(({ material, mapType, expectedFilename }) => {
			const texture = loadedTextures.get(expectedFilename);
			if (texture) {
				material[mapType] = texture;

				// If applying a color map, ensure material color is white (not gray/dark)
				if (mapType === 'map' && material.color) {
					material.color.setHex(0xffffff);
				}

				material.needsUpdate = true;
				stillMissing.delete(expectedFilename);
				appliedCount++;
			}
		});

		// Update missing textures list
		setMissingTextures(Array.from(stillMissing));

		// Remove applied materials from the tracking list
		if (appliedCount > 0) {
			materialsNeedingTexturesRef.current = materialsNeedingTexturesRef.current.filter(
				({ expectedFilename }) => stillMissing.has(expectedFilename)
			);

			// Force renderer to update
			if (rendererRef.current && sceneRef.current && cameraRef.current) {
				rendererRef.current.render(sceneRef.current, cameraRef.current);
			}
		}
	};

	const playAnimation = (index) => {
		if (!mixerRef.current) return;

		const action = actionsRef.current[index];
		const currentAction =
			activeAnimIndex !== null ? actionsRef.current[activeAnimIndex] : null;

		if (currentAction && currentAction !== action) {
			currentAction.fadeOut(0.5);
		}

		if (action) {
			action.reset().fadeIn(0.5).play();
			setActiveAnimIndex(index);
			setIsPlaying(true);
		}
	};

	const stopAnimation = () => {
		if (activeAnimIndex !== null && actionsRef.current[activeAnimIndex]) {
			actionsRef.current[activeAnimIndex].fadeOut(0.5);
		}
		setActiveAnimIndex(null);
		setIsPlaying(false);
	};

	return (
		<div
			className="app font-sans"
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			role="application"
		>
			<div className="viewer" ref={containerRef} />
			<video
				ref={videoRef}
				className="hidden"
				playsInline
				muted
				tabIndex={-1}
			>
				<track kind="captions" />
			</video>

			<input
				type="file"
				ref={fileInputRef}
				onChange={handleFileSelect}
				className="hidden"
				accept=".glb,.gltf"
			/>

			<input
				type="file"
				ref={textureFileInputRef}
				onChange={handleTextureSelect}
				className="hidden"
				accept="image/*"
				multiple
			/>

			{/* Left Panel: Metadata */}
			<div className="absolute top-4 left-4 w-64 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg p-4 text-white shadow-xl transition-opacity duration-300">
				<div className="flex items-center gap-2 mb-4">
					<Box className="w-5 h-5 text-blue-400" />
					<h2 className="font-semibold text-sm uppercase tracking-wider">
						Model Info
					</h2>
				</div>

				{metadata ? (
					<div className="space-y-3 text-sm text-gray-300">
						<div>
							<span className="block text-xs text-gray-500 uppercase">
								Name
							</span>
							<span className="font-medium text-white truncate block">
								{metadata.name}
							</span>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<span className="block text-xs text-gray-500 uppercase">
									Vertices
								</span>
								<span>{metadata.vertices}</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500 uppercase">
									Triangles
								</span>
								<span>{metadata.triangles}</span>
							</div>
						</div>
					</div>
				) : (
					<div className="text-sm text-gray-500 italic py-2">
						No model loaded.
					</div>
				)}

				<button
					onClick={() => fileInputRef.current?.click()}
					className="mt-4 w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors py-2 px-3 rounded text-sm font-medium"
				>
					<FolderOpen className="w-4 h-4" />
					Open File
				</button>

				{missingTextures.length > 0 && (
					<button
						onClick={() => textureFileInputRef.current?.click()}
						className="mt-2 w-full flex items-center justify-center gap-2 bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 border border-amber-500/30 transition-colors py-2 px-3 rounded text-sm font-medium text-amber-200"
					>
						<FolderOpen className="w-4 h-4" />
						Open Textures ({missingTextures.length})
					</button>
				)}
			</div>

			{/* Right Panel: Animations */}
			{animations.length > 0 && (
				<div className="absolute top-4 right-4 w-64 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg p-4 text-white shadow-xl max-h-[80vh] flex flex-col">
					<div className="flex items-center gap-2 mb-4 shrink-0">
						<Play className="w-5 h-5 text-green-400" />
						<h2 className="font-semibold text-sm uppercase tracking-wider">
							Animations
						</h2>
					</div>

					<div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
						{animations.map((clip, idx) => (
							<button
								key={idx}
								onClick={() => playAnimation(idx)}
								className={clsx(
									"w-full text-left px-3 py-2 rounded text-sm transition-all flex items-center gap-2",
									activeAnimIndex === idx
										? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
										: "hover:bg-white/5 text-gray-400 hover:text-white",
								)}
							>
								<span className="truncate flex-1">{clip.name}</span>
								{activeAnimIndex === idx && isPlaying && (
									<div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
								)}
							</button>
						))}
					</div>

					<div className="mt-4 pt-3 border-t border-white/10 shrink-0 flex gap-2">
						<button
							onClick={stopAnimation}
							disabled={!isPlaying}
							className="flex-1 flex items-center justify-center gap-2 bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed py-2 rounded text-sm font-medium transition-colors"
						>
							<Square className="w-4 h-4 fill-current" />
							Stop
						</button>
					</div>
				</div>
			)}

			{status === "loading" && (
				<div className="placeholder animate-pulse">{statusCopy[status]}</div>
			)}

			{status === "idle" && (
				<div className="placeholder text-center">
					<p className="mb-2">{statusCopy.idle}</p>
					<p className="text-sm opacity-50">
						Use pinch gesture to rotate model
					</p>
				</div>
			)}

			{status === "error" && (
				<div className="placeholder text-red-400">{statusCopy.error}</div>
			)}
		</div>
	);
}