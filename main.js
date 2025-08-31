import { mat4, vec3 } from 'https://cdn.jsdelivr.net/npm/wgpu-matrix@3/+esm'

if (!('gpu' in navigator)) throw new Error('WebGPU not supported')

const canvas = document.getElementById('gfx')
const context = canvas.getContext('webgpu')

const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })

// WSGL: Lambert shading
const shaderWGSL = /* wgsl */ `
struct Uniforms {
    mvp:            mat4x4<f32>,
    normalMatrix:   mat4x4<f32>,  // inverse-transpose of model
    lightDir:       vec3<f32>,    // direction from light toward scene (world space, normalized)
    _pad0:          f32,
};
@group(0) @binding(0) var<uniform> U: Uniforms;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) color: vec3<f32>,
};

@vertex
fn vs(@location(0) inPos: vec3<f32>,
      @location(1) inNrm: vec3<f32>,
      @location(2) inCol: vec3<f32>) -> VSOut {

    // transform normal with inverse-transpose(model)
    let n = normalize( (U.normalMatrix * vec4<f32>(inNrm, 0.0)).xyz );

    var out: VSOut;
    out.pos = U.mvp * vec4<f32>(inPos, 1.0);
    out.normal = n;
    out.color = inCol;
    return out;
}

@fragment
fn fs(@location(0) nrm: vec3<f32>,
      @location(1) albedo: vec3<f32>) -> @location(0) vec4<f32> {

    // For a lightDir pointing FROM light toward the scene,
    // L (toward light ) = -lightDir
    let N = normalize(nrm);
    let L = normalize(-U.lightDir);
    let ndotl = max(dot(N, L), 0.0);

    let ambient = 0.15;
    let lit = albedo * (ambient + ndotl * 0.85);

    return vec4<f32>(lit, 1.0);
}
`
const module = device.createShaderModule({ code: shaderWGSL })

// Cube geometry: (24 verts: pos, normal, color)
// prettier-ignore
const verts = new Float32Array([
  // face: +Z (front)
  -1,-1, 1,   0,0, 1,   1,0,0,
   1,-1, 1,   0,0, 1,   1,1,0,
   1, 1, 1,   0,0, 1,   1,1,1,
  -1, 1, 1,   0,0, 1,   1,0,1,
  // -Z (back)
  -1,-1,-1,   0,0,-1,   0,0,1,
   1,-1,-1,   0,0,-1,   0,1,1,
   1, 1,-1,   0,0,-1,   0,1,0,
  -1, 1,-1,   0,0,-1,   0,0,0,
  // +X (right)
   1,-1, 1,   1,0,0,    1,1,0,
   1,-1,-1,   1,0,0,    0,1,1,
   1, 1,-1,   1,0,0,    0,1,0,
   1, 1, 1,   1,0,0,    1,1,1,
  // -X (left)
  -1,-1,-1,  -1,0,0,    0,0,1,
  -1,-1, 1,  -1,0,0,    1,0,0,
  -1, 1, 1,  -1,0,0,    1,0,1,
  -1, 1,-1,  -1,0,0,    0,0,0,
  // +Y (top)
  -1, 1, 1,   0,1,0,    1,0,1,
   1, 1, 1,   0,1,0,    1,1,1,
   1, 1,-1,   0,1,0,    0,1,0,
  -1, 1,-1,   0,1,0,    0,0,0,
  // -Y (bottom)
  -1,-1,-1,   0,-1,0,   0,0,1,
   1,-1,-1,   0,-1,0,   0,1,1,
   1,-1, 1,   0,-1,0,   1,1,0,
  -1,-1, 1,   0,-1,0,   1,0,0,
]);
// 12 triangles (36 indices), CCW
// prettier-ignore
const indices = new Uint16Array([
    0,1,2,    0,2,3,     // +Z
    4,7,6,    4,6,5,     // -Z
    8,9,10,   8,10,11,  // +X
    12,13,14, 12,14,15,  // -X
    16,17,18, 16,18,19,  // +Y
    20,21,22, 20,22,23,  // -Y
]);
const vertexBuffer = device.createBuffer({
    size: verts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(vertexBuffer, 0, verts)
const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(indexBuffer, 0, indices)

// vertex layout: pos(3), normal(3), color(3) -> 9 floats -> 36 bytes stride
const vertexBuffers = [
    {
        arrayStride: 9 * 4,
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, // norrmal
            { shaderLocation: 2, offset: 6 * 4, format: 'float32x3' }, // color
        ],
    },
]

// Depth
const depthFormat = 'depth24plus'
let depthTex = makeDepthTexture()

function makeDepthTexture() {
    return device.createTexture({
        size: { width: canvas.width, height: canvas.height, depthOrArrayLayers: 1 },
        format: depthFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
}

const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: vertexBuffers },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: 'less', // keep closest fragment
    },
})

// Uniforms (MVP)
const UNIFORM_FLOATS = 16 + 16 + 4
const uniformBuffer = device.createBuffer({
    size: UNIFORM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})
const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
})

// light direction (world space), normalized
const lightDir = vec3.normalize(vec3.create(1, 1, -1))

function updateUniforms() {
    const t = performance.now() * 0.001
    const aspect = canvas.width / canvas.height

    // Model: rotate
    let M = mat4.rotationY(t)
    M = mat4.multiply(mat4.rotationX(t * 0.6), M)

    // View & Projection
    const V = mat4.lookAt(vec3.create(0, 0, 5), vec3.create(0, 0, 0), vec3.create(0, 1, 0))
    const P = mat4.perspective(Math.PI / 3, aspect, 0.1, 100)

    const MVP = mat4.multiply(mat4.multiply(P, V), M)

    // Normal matrix as 4x4: transpose(inverse(M))
    const Minv = mat4.invert(M)
    const N4 = mat4.transpose(Minv)

    // Pack uniforms: [MVP(16), N4(16), lightDir(3), pad]
    const data = new Float32Array(UNIFORM_FLOATS)
    data.set(MVP, 0)
    data.set(N4, 16)
    data.set(lightDir, 32)
    data[35] = 0.0 // pad
    device.queue.writeBuffer(uniformBuffer, 0, data)
}

function frame() {
    updateUniforms()

    const encoder = device.createCommandEncoder()
    const colorView = context.getCurrentTexture().createView()
    const depthView = depthTex.createView()

    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: colorView,
                loadOp: 'clear',
                clearValue: { r: 0.06, g: 0.08, b: 0.1, a: 1.0 },
                storeOp: 'store',
            },
        ],
        depthStencilAttachment: {
            view: depthView,
            depthLoadOp: 'clear',
            depthClearValue: 1.0,
            depthStoreOp: 'store',
        },
    })

    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, vertexBuffer)
    pass.setIndexBuffer(indexBuffer, 'uint16')
    pass.drawIndexed(indices.length)
    pass.end()

    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
}
frame()
