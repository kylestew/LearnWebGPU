if (!('gpu' in navigator)) throw new Error('WebGPU not supported')

const canvas = document.getElementById('gfx')
const context = canvas.getContext('webgpu')

const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })

// 1) Add a uniform struct and use it to wobble the triangle
const shaderWGSL = /* wgsl */ `
struct Uniforms {
    time   : f32,
    aspect : f32,
    amp    : f32,
    _pad   : f32, // 16-byte alignment (std140-like packing)
};
@group(0) @binding(0) var<uniform> U: Uniforms;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs(@location(0) inPos: vec2<f32>,
      @location(1) inCol: vec3<f32>) -> VSOut {
    // scale x by aspect to keep proportions on non-square canvases
    var p = vec2<f32>(inPos.x * U.aspect, inPos.y);

    // wobble the vertices a bit with time-based sine
    let wobble = sin(U.time + inPos.x * 3.14159) * U.amp;
    p.y += wobble;

    var out: VSOut;
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.color = inCol;
    return out;
}

@fragment
fn fs(@location(0) color: vec3<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(color, 1.0);
}
`
const module = device.createShaderModule({ code: shaderWGSL })

// Same interleaved vertex data as A2: [x, y, r, g, b]
// prettier-ignore
const verts = new Float32Array([
    // x,   y,    r,   g,   b
     0.0, 0.6,  1.0, 0.2, 0.2, // top   (red-ish)
    -0.6,-0.6,  0.2, 1.0, 0.2, // left  (green-ish)
     0.6,-0.6,  0.2, 0.6, 1.0, // right (blue-ish)
]);
const vertexBuffer = device.createBuffer({
    size: verts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(vertexBuffer, 0, verts)

const vertexBuffers = [
    {
        arrayStride: 5 * 4,
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position (x, y)
            { shaderLocation: 1, offset: 2 * 4, format: 'float32x3' }, // color (r, g, b)
        ],
    },
]

const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: vertexBuffers },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
})

// 2) Uniform buffer + bind group
// Create the buffer as before
const UNIFORM_BYTES = 16 // 4 loats (time, aspect, amp, pad)
const uniformBuffer = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
})

// Using layout:'auto', obtain group(0) from the pipeline:
// A bind group is how you attach GPU resources (uniform buffers, storage buffer,
// textures, and samples) to your shaders
const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
})

const start = performance.now()
const amp = 0.15

function frame() {
    const t = (performance.now() - start) / 1000 // seconds
    const aspect = canvas.height === 0 ? 1 : canvas.height / canvas.width

    // Write time + aspect + amp (and a pad) each frame
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([t, aspect, amp, 0]))

    const encoder = device.createCommandEncoder()
    const view = context.getCurrentTexture().createView()

    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view,
                loadOp: 'clear',
                clearValue: { r: 0.06, g: 0.08, b: 0.1, a: 1.0 },
                storeOp: 'store',
            },
        ],
    })

    pass.setPipeline(pipeline)

    // attached the entire set of resources at once
    // there is a limit to the number of bind groups you can have
    // sometimes people group resources by how often they need to be
    // rebound (per frame, per material update, etc)
    pass.setBindGroup(0, bindGroup)

    pass.setVertexBuffer(0, vertexBuffer)
    pass.draw(3)
    pass.end()

    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
}
frame()
