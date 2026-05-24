import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

export class Orbital3DRenderer {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    
    // Scene Setup
    this.scene = new THREE.Scene();
    
    // Camera Setup
    this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    this.camera.position.set(20, 15, 20);

    // Renderer Setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.container.appendChild(this.renderer.domElement);

    // Controls Setup
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 100;

    // Lighting Setup
    const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(50, 20, 30);
    this.scene.add(directionalLight);

    // Track objects
    this.satellites = new Map();
    this.debrisMesh = null;
    this.debrisCount = 0;
    this.dummy = new THREE.Object3D();

    this.initEarth();
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);

    this.animate = this.animate.bind(this);
    this.animate();
  }

  initEarth() {
    // Earth Radius scaled: 6378 km -> 6.378
    const radius = 6.378137;
    const segments = 64;
    const geometry = new THREE.SphereGeometry(radius, segments, segments);
    
    // Loading textures from unpkg/cdn to simulate realistic Earth observation style
    const textureLoader = new THREE.TextureLoader();
    const material = new THREE.MeshPhongMaterial({
      map: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'),
      bumpMap: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-topology.png'),
      bumpScale: 0.1,
      specularMap: textureLoader.load('https://unpkg.com/three-globe/example/img/earth-water.png'),
      specular: new THREE.Color('grey')
    });

    this.earth = new THREE.Mesh(geometry, material);
    this.scene.add(this.earth);

    // Subtle atmospheric glow
    const atmosGeometry = new THREE.SphereGeometry(radius * 1.02, 64, 64);
    const atmosMaterial = new THREE.MeshBasicMaterial({
      color: 0x60c4ff,
      transparent: true,
      opacity: 0.1,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending
    });
    const atmos = new THREE.Mesh(atmosGeometry, atmosMaterial);
    this.scene.add(atmos);
  }

  latLonToXYZ(lat, lon, alt_km) {
    const R = 6.378137 + (alt_km / 1000);
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    const x = -(R * Math.sin(phi) * Math.cos(theta));
    const z = R * Math.sin(phi) * Math.sin(theta);
    const y = R * Math.cos(phi);

    return new THREE.Vector3(x, y, z);
  }

  getColorForStatus(status) {
    if (status === 'COLLIDED') return 0xff5f72;
    if (status === 'EVADING') return 0xffbe55;
    return 0x5ff0b2;
  }

  update(snapshot) {
    if (!snapshot) return;

    // 1. Update Satellites
    snapshot.satellites.forEach(sat => {
      let mesh = this.satellites.get(sat.id);
      if (!mesh) {
        // Create new satellite mesh
        const geometry = new THREE.SphereGeometry(0.08, 16, 16);
        const material = new THREE.MeshBasicMaterial();
        mesh = new THREE.Mesh(geometry, material);
        this.scene.add(mesh);
        this.satellites.set(sat.id, mesh);
      }
      
      const pos = this.latLonToXYZ(sat.lat, sat.lon, sat.alt_km || 500);
      mesh.position.copy(pos);
      // Look at center to align
      mesh.lookAt(0, 0, 0);

      // Status coloration
      const colorHex = this.getColorForStatus(sat.status);
      mesh.material.color.setHex(colorHex);
      
      // Scale slightly if something is active
      if (sat.status === 'EVADING' || sat.active_cdms > 0) {
        mesh.scale.set(2, 2, 2);
      } else {
        mesh.scale.set(1, 1, 1);
      }
    });

    // 2. Update Debris Cloud (InstancedMesh)
    const debrisArray = snapshot.debris_cloud || [];
    const count = debrisArray.length;

    // Check if we need to recreate the InstancedMesh for a larger count
    if (!this.debrisMesh || this.debrisMesh.count < count) {
      if (this.debrisMesh) this.scene.remove(this.debrisMesh);
      
      // Tiny debris geometry
      const geometry = new THREE.BoxGeometry(0.02, 0.02, 0.02);
      const material = new THREE.MeshBasicMaterial({ color: 0x84a5c6, transparent: true, opacity: 0.6 });
      
      // Allow slight buffer
      const maxCount = Math.max(count + 1000, 10000);
      this.debrisMesh = new THREE.InstancedMesh(geometry, material, maxCount);
      this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(this.debrisMesh);
    }

    // Assign positions
    this.debrisMesh.count = count;
    for (let i = 0; i < count; i++) {
        const item = debrisArray[i];
        // schema: [id, lat, lon, alt_km]
        const lat = item[1];
        const lon = item[2];
        const alt = item[3];

        const pos = this.latLonToXYZ(lat, lon, alt);
        this.dummy.position.copy(pos);
        this.dummy.updateMatrix();
        
        this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  handleResize() {
    if (!this.container) return;
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }

  animate() {
    requestAnimationFrame(this.animate);
    
    // Slow earth rotation
    if (this.earth) {
        this.earth.rotation.y += 0.0002;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
