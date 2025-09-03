import { mat4, vec3 } from 'https://cdn.jsdelivr.net/npm/wgpu-matrix@3/+esm'

if (!('gpu' in navigator)) throw new Error('WebGPU not supported')

const canvas = document.getElementById('gfx')
const context = canvas.getContext('webgpu')

const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })

// WGSL: Non-lit cube with instancing
const shaderWGSL = /* wgsl */ `
struct Uniforms {
    mvp: mat4x4<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};
@group(0) @binding(0) var<uniform> U: Uniforms;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs(@location(0) vertexPos: vec3<f32>,
      @location(1) vertexColor: vec3<f32>,
      @location(2) instancePos: vec3<f32>,
      @location(3) instanceColor: vec3<f32>,
      @location(4) instanceScale: f32,
      @builtin(instance_index) instanceIdx: u32) -> VSOut {

    // Apply wave animation based on instance position and time
    let waveOffset = sin(U.time + instancePos.x * 0.5 + instancePos.z * 0.5) * 0.3;
    let animatedPos = instancePos + vec3<f32>(0.0, waveOffset, 0.0);
    
    // Scale vertex position, then translate by instance position
    let scaledPos = vertexPos * instanceScale;
    let worldPos = scaledPos + animatedPos;
    
    var out: VSOut;
    out.pos = U.mvp * vec4<f32>(worldPos, 1.0);
    out.color = mix(vertexColor, instanceColor, 0.7); // blend vertex and instance colors
    return out;
}

@fragment
fn fs(@location(0) color: vec3<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(color, 1.0);
}
`
const module = device.createShaderModule({ code: shaderWGSL })

// Cube geometry: (24 verts: pos, color)
// prettier-ignore
const verts = new Float32Array([
  // face: +Z (front)
  -1,-1, 1,   1,0,0,
   1,-1, 1,   1,1,0,
   1, 1, 1,   1,1,1,
  -1, 1, 1,   1,0,1,
  // -Z (back)
  -1,-1,-1,   0,0,1,
   1,-1,-1,   0,1,1,
   1, 1,-1,   0,1,0,
  -1, 1,-1,   0,0,0,
  // +X (right)
   1,-1, 1,   1,1,0,
   1,-1,-1,   0,1,1,
   1, 1,-1,   0,1,0,
   1, 1, 1,   1,1,1,
  // -X (left)
  -1,-1,-1,   0,0,1,
  -1,-1, 1,   1,0,0,
  -1, 1, 1,   1,0,1,
  -1, 1,-1,   0,0,0,
  // +Y (top)
  -1, 1, 1,   1,0,1,
   1, 1, 1,   1,1,1,
   1, 1,-1,   0,1,0,
  -1, 1,-1,   0,0,0,
  // -Y (bottom)
  -1,-1,-1,   0,0,1,
   1,-1,-1,   0,1,1,
   1,-1, 1,   1,1,0,
  -1,-1, 1,   1,0,0,
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

// Create instance data: grid of cubes
const GRID_SIZE = 10
const INSTANCE_COUNT = GRID_SIZE * GRID_SIZE * GRID_SIZE
const instanceData = new Float32Array(INSTANCE_COUNT * 8) // pos(3) + color(3) + scale(1) + pad(1)

let idx = 0
for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let z = 0; z < GRID_SIZE; z++) {
            const baseIdx = idx * 8

            // Position: center the grid around origin
            instanceData[baseIdx + 0] = (x - GRID_SIZE / 2) * 2.5
            instanceData[baseIdx + 1] = (y - GRID_SIZE / 2) * 2.5
            instanceData[baseIdx + 2] = (z - GRID_SIZE / 2) * 2.5

            // Color: gradient based on position
            instanceData[baseIdx + 3] = x / GRID_SIZE // R
            instanceData[baseIdx + 4] = y / GRID_SIZE // G
            instanceData[baseIdx + 5] = z / GRID_SIZE // B

            // Scale: vary between 0.3 and 0.8
            instanceData[baseIdx + 6] = 0.3 + (Math.sin(x + y + z) * 0.25 + 0.25)

            // Padding for alignment
            instanceData[baseIdx + 7] = 0.0

            idx++
        }
    }
}

const instanceBuffer = device.createBuffer({
    size: instanceData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(instanceBuffer, 0, instanceData)

// vertex layout: pos(3), color(3) -> 6 floats -> 24 bytes stride
const vertexBuffers = [
    {
        arrayStride: 6 * 4,
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, // color
        ],
    },
    {
        arrayStride: 8 * 4, // instancePos(3) + instanceColor(3) + scale(1) + pad(1)
        stepMode: 'instance',
        attributes: [
            { shaderLocation: 2, offset: 0, format: 'float32x3' }, // instancePos
            { shaderLocation: 3, offset: 3 * 4, format: 'float32x3' }, // instanceColor
            { shaderLocation: 4, offset: 6 * 4, format: 'float32' }, // instanceScale
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

// Uniforms (MVP + time)
const UNIFORM_FLOATS = 16 + 4 // MVP(16) + time + padding(3)
const uniformBuffer = device.createBuffer({
    size: UNIFORM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})
const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
})

function updateUniforms() {
    const t = performance.now() * 0.001
    const aspect = canvas.width / canvas.height

    // View & Projection (no model matrix, instances handle positioning)
    const V = mat4.lookAt(vec3.create(20, 15, 20), vec3.create(0, 0, 0), vec3.create(0, 1, 0))
    const P = mat4.perspective(Math.PI / 4, aspect, 0.1, 100)
    const MVP = mat4.multiply(P, V)

    // Pack uniforms: [MVP(16), time(1), pad(3)]
    const data = new Float32Array(UNIFORM_FLOATS)
    data.set(MVP, 0)
    data[16] = t
    data[17] = 0.0 // pad
    data[18] = 0.0 // pad
    data[19] = 0.0 // pad
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
    pass.setVertexBuffer(0, vertexBuffer) // vertex data
    pass.setVertexBuffer(1, instanceBuffer) // instance data
    pass.setIndexBuffer(indexBuffer, 'uint16')
    pass.drawIndexed(indices.length, INSTANCE_COUNT) // draw all instances
    pass.end()

    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
}
frame()
