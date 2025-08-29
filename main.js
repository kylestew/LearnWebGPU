// add this at the top
import { mat4, vec3 } from 'https://cdn.jsdelivr.net/npm/wgpu-matrix@3/+esm'

if (!('gpu' in navigator)) throw new Error('WebGPU not supported')

const canvas = document.getElementById('gfx')
const context = canvas.getContext('webgpu')

const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })

// WSGL: positions + UVs, sample tex with sampler
const shaderWGSL = /* wgsl */ `
struct Uniforms {
    mvp: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> U: Uniforms;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs(@location(0) inPos: vec3<f32>,
      @location(1) inCol: vec3<f32>) -> VSOut {
    var out: VSOut;
    out.pos = U.mvp * vec4<f32>(inPos, 1.0);
    out.color = inCol;
    return out;
}

@fragment
fn fs(@location(0) color: vec3<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(color, 1.0);
}
`
const module = device.createShaderModule({ code: shaderWGSL })

// Cube geometry: (pos.xyz, color.rgb | interleaved)
// prettier-ignore
const verts = new Float32Array([
    // front (+Z)
    -1,-1, 1,   1,0,0,
     1,-1, 1,   1,1,0,
     1, 1, 1,   1,1,1,
    -1, 1, 1,   1,0,1,
    // back (-Z)
    -1,-1,-1,   0,0,1,
     1,-1,-1,   0,1,1,
     1, 1,-1,   0,1,0,
    -1, 1,-1,   0,0,0,
]);
// 12 triangles (36 indices), CCW
// prettier-ignore
const indices = new Uint16Array([
    0,1,2,  2,3,0,  // front
    1,5,6,  6,2,1,  // right
    5,4,7,  7,6,5,  // back
    4,0,3,  3,7,4,  // left
    3,2,6,  6,7,3,  // top
    4,5,1,  1,0,4,  // bottom
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

// vertex layout: 6 floats per-vertex (pos: 3, color: 3)
const vertexBuffers = [
    {
        arrayStride: 6 * 4,
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
            { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' }, // color
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
const uniformBuffer = device.createBuffer({
    size: 16 * 4, // 4x4 matrix (f32)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})
const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
})

const start = performance.now()

function updateUniforms() {
    const t = performance.now() * 0.001
    const aspect = canvas.width / canvas.height

    const M = mat4.rotationY(t)
    const V = mat4.lookAt(vec3.create(0, 0, 4), vec3.create(0, 0, 0), vec3.create(0, 1, 0))
    const P = mat4.perspective(Math.PI / 3, aspect, 0.1, 100) // WebGPU-friendly (Z in 0..1)
    const VP = mat4.multiply(P, V)
    const MVP = mat4.multiply(VP, M)

    device.queue.writeBuffer(uniformBuffer, 0, MVP)
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
    pass.drawIndexed(36, 1, 0, 0, 0)
    pass.end()

    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
}
frame()
