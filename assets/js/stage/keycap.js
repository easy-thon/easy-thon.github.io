// EasyThon 2026 · keycaps
// One cap shape, drawn for every key at once (an InstancedMesh). The vertex shader builds each instance from its own
// size, corner radius, taper and dish, so the same mesh is a 1u letter, a 7u space bar, a flat chip in a prize stack
// and the plate under them all. The depth pass that casts the shadows runs the same shape code.
// A plain script, like the rest of the stage, so the page also works opened straight from disk; three.js is handed in.
(parts => {
  // A box whose every vertex knows where it sits in the box's straight core (aCore, -1..1 per axis) and which way
  // its rounded corner faces (normal); the shader then grows the core to any size and wraps the corners round it.
  function keycapGeometry(THREE, detail = 1) {
    const band = detail > 0.75 ? 4 : 3;                       // segments in each rounded edge
    const along = band * 2 + Math.max(2, Math.round(4 * detail));
    const up = band * 2 + 2;
    const across = band * 2 + Math.max(4, Math.round(8 * detail));   // the dish curves across the depth
    const geo = new THREE.BoxGeometry(2, 2, 2, along, up, across);
    const position = geo.attributes.position;
    const normal = geo.attributes.normal;
    const core = new Float32Array(position.count * 3);
    const split = (value, steps) => {
      const i = Math.round(((value + 1) / 2) * steps);
      if (i < band) return [-1, -Math.tan(((band - i) / band) * (Math.PI / 4))];
      if (i > steps - band) return [1, Math.tan(((i - steps + band) / band) * (Math.PI / 4))];
      return [-1 + (2 * (i - band)) / (steps - 2 * band), 0];
    };
    for (let v = 0; v < position.count; v++) {
      const [cx, dx] = split(position.getX(v), along);
      const [cy, dy] = split(position.getY(v), up);
      const [cz, dz] = split(position.getZ(v), across);
      const length = Math.hypot(dx, dy, dz);
      core.set([cx, cy, cz], v * 3);
      normal.setXYZ(v, dx / length, dy / length, dz / length);
    }
    geo.setAttribute('aCore', new THREE.BufferAttribute(core, 3));
    geo.deleteAttribute('uv');
    return geo;
  }

  // per instance: size and corner radius, taper, dish and legend turn, base colour, legend, and finish
  const ATTRIBUTES = { aSize: 4, aProfile: 4, aColor: 3, aLegend: 4, aLook: 4 };

  const SHAPE = /* glsl */ `
    attribute vec3 aCore;
    attribute vec4 aSize;      // width, height, depth, corner radius
    attribute vec4 aProfile;   // how far the top is drawn in, depth of the dish, turn of the legend
    vec3 capShape(out vec3 capNormal) {
      vec3 halfSize = aSize.xyz * 0.5;
      float radius = min(aSize.w, min(halfSize.x, min(halfSize.y, halfSize.z)));
      vec3 core = max(halfSize - radius, 0.0);
      float rise = aCore.y * 0.5 + 0.5;
      float inset = min(aProfile.x, min(core.x, core.z));
      vec3 drawn = vec3(core.x - inset * rise, core.y, core.z - inset * rise);
      vec3 p = aCore * drawn + normal * radius;
      vec3 n = normal;
      // the walls lean in as the top is drawn in
      n.y += (abs(n.x) + abs(n.z)) * (1.0 - abs(normal.y)) * inset / max(2.0 * core.y, 1e-4);
      // a cylindrical dish across the top, for the finger
      float dish = step(0.999, aCore.y) * aProfile.y;
      p.y -= dish * (1.0 - aCore.z * aCore.z);
      n.z -= n.y * dish * 2.0 * aCore.z / max(drawn.z, 1e-4);
      capNormal = normalize(n);
      return p;
    }
  `;

  function keycapMaterial(THREE, legends) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, envMapIntensity: 0.75 });
    material.onBeforeCompile = shader => {
      shader.uniforms.uLegends = { value: legends.texture };
      shader.uniforms.uLegendCols = { value: legends.cols };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          ${SHAPE}
          attribute vec3 aColor;
          attribute vec4 aLegend;   // atlas cell (below zero: none), centre x, centre z, size
          attribute vec4 aLook;     // roughness, metalness, legend opacity, glow
          varying vec3 vTint;
          varying vec3 vLegendTint;
          varying vec2 vLegendUv;
          varying float vLegendCell;
          varying float vLegendOn;
          varying vec4 vLook;`)
        .replace('#include <beginnormal_vertex>', `
          vec3 capNormal;
          vec3 capPoint = capShape(capNormal);
          vec3 objectNormal = capNormal;
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif
          // the foot of every wall sits in the shade of its neighbours
          vTint = aColor * mix(0.72, 1.0, smoothstep(0.0, 0.85, aCore.y * 0.5 + 0.5));
          // dark legends on light caps, light ones on dark and red caps
          float capLight = dot(aColor, vec3(0.2126, 0.7152, 0.0722));
          vLegendTint = mix(vec3(0.88, 0.865, 0.82), vec3(0.055, 0.052, 0.046), smoothstep(0.3, 0.5, capLight));
          // the legend is turned on the cap (a numeral stays upright on a turned key)
          vec2 legendAt = capPoint.xz - aLegend.yz;
          float turnC = cos(aProfile.z);
          float turnS = sin(aProfile.z);
          legendAt = vec2(turnC * legendAt.x - turnS * legendAt.y, turnS * legendAt.x + turnC * legendAt.y);
          vLegendUv = legendAt / max(aLegend.w, 1e-4) + 0.5;
          vLegendCell = aLegend.x;
          vLegendOn = step(0.999, aCore.y) * step(0.0, aLegend.x) * aLook.z;
          vLook = aLook;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = capPoint;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uLegends;
          uniform float uLegendCols;
          varying vec3 vTint;
          varying vec3 vLegendTint;
          varying vec2 vLegendUv;
          varying float vLegendCell;
          varying float vLegendOn;
          varying vec4 vLook;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= vTint;
          if (vLegendOn > 0.001) {
            vec2 inCell = clamp(vLegendUv, 0.0, 1.0);
            float inside = step(0.0, vLegendUv.x) * step(vLegendUv.x, 1.0) * step(0.0, vLegendUv.y) * step(vLegendUv.y, 1.0);
            float cell = floor(vLegendCell + 0.5);
            vec2 at = vec2(mod(cell, uLegendCols), floor(cell / uLegendCols));
            vec2 uv = vec2((at.x + inCell.x) / uLegendCols, 1.0 - (at.y + inCell.y) / uLegendCols);
            float ink = texture2D(uLegends, uv).a * inside * min(vLegendOn, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vLegendTint, ink);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = vLook.x;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = vLook.y;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vTint * vLook.w;`);
    };
    return material;
  }

  // the shadow pass needs the same shape, or the shadows would be cast by unit cubes
  function keycapDepthMaterial(THREE) {
    const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          ${SHAPE}`)
        .replace('#include <begin_vertex>', `
          vec3 capNormal;
          vec3 transformed = capShape(capNormal);`);
    };
    return material;
  }

  parts.keycap = { keycapGeometry, keycapMaterial, keycapDepthMaterial, ATTRIBUTES };
})(window.EasyThonStage = window.EasyThonStage || {});
