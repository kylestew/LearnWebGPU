if (!('gpu' in navigator)) throw new Error('WebGPU not supported')

const canvas = document.getElementById('gfx')
const context = canvas.getContext('webgpu')

const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const format = navigator.gpu.getPreferredCanvasFormat()
context.configure({ device, format, alphaMode: 'opaque' })

// WSGL: positions + UVs, sample tex with sampler
const shaderWGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@location(0) inPos: vec2<f32>,
      @location(1) inUV: vec2<f32>) -> VSOut {
    var out: VSOut;
    out.pos = vec4<f32>(inPos, 0.0, 1.0); // clip-space position
    out.uv = inUV;
    return out;
}

@fragment
fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(tex, samp, uv);
}
`
const module = device.createShaderModule({ code: shaderWGSL })

// Vertex Data: 2 triangles forming a quad (pos.xy, uv.xy)
// Clip-space quad ~ 1.6 x 1.6 units centered, UVs 0..1
// prettier-ignore
const verts = new Float32Array([
    // x,    y,  u,  v
    -0.8,  0.8,  0,  0,
    -0.8, -0.8,  0,  1,
     0.8, -0.8,  1,  1,

    -0.8,  0.8,  0,  0,
     0.8, -0.8,  1,  1,
     0.8,  0.8,  1,  0,
]);
const vertexBuffer = device.createBuffer({
    size: verts.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
})
device.queue.writeBuffer(vertexBuffer, 0, verts)

// description
const vertexBuffers = [
    {
        arrayStride: 4 * 4, // 4 floats per-vertex
        attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' }, // pos
            { shaderLocation: 1, offset: 2 * 4, format: 'float32x2' }, // uv
        ],
    },
]

// Create a checkerboard texture (RGBA8) in linear memory [Uint8]
const W = 256,
    H = 256 // bytesPerRow must be multiple of 256 -> 256*4=1024
const pixels = new Uint8Array(W * H * 4)
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const c = ((x >> 5) & 1) ^ ((y >> 5) & 1) ? 230 : 40 // 32px tiles
        pixels[i + 0] = c // R
        pixels[i + 1] = c // G
        pixels[i + 2] = c // B
        pixels[i + 3] = 255 // A
    }
}

// Create an RGBA8 GPU texture and upload the CPU `pixels` data into it
// (rows pitched by bytesPerRow) so shaders can sample it.
const texture = device.createTexture({
    size: { width: W, height: H, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
})
device.queue.writeTexture(
    { texture },
    pixels,
    { bytesPerRow: W * 4, rowsPerImage: H },
    { width: W, height: H, depthOrArrayLayers: 1 }
)

// Create a sampler that clamps UVs at the edges and uses linear filtering
// for minification and magnification.
const sampler = device.createSampler({
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
})

const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs', buffers: vertexBuffers },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
})

const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: texture.createView() },
    ],
})

const start = performance.now()
const amp = 0.15

function frame() {
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
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, vertexBuffer)
    pass.draw(6)
    pass.end()

    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
}
frame()
